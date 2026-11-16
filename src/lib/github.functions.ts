import { createServerFn } from "@tanstack/react-start";

const GW = "https://connector-gateway.lovable.dev/github";

async function gh<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const lk = process.env["LOVABLE_API_KEY"];
  const gk = process.env["GITHUB_API_KEY"];
  if (!lk || !gk) throw new Error("GitHub kapcsolat nincs beállítva");
  const res = await fetch(`${GW}/${path.replace(/^\//, "")}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${lk}`,
      "X-Connection-Api-Key": gk,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`GitHub hiba [${res.status}]: ${body.slice(0, 500)}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  const u = await gh<{ login: string; avatar_url: string }>("user");
  return { login: u.login, avatar: u.avatar_url };
});

export const listRepos = createServerFn({ method: "GET" }).handler(async () => {
  const all: { full_name: string; default_branch: string; private: boolean }[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await gh<any[]>(`user/repos?per_page=100&sort=updated&page=${page}`);
    all.push(...r.map((x) => ({ full_name: x.full_name, default_branch: x.default_branch, private: x.private })));
    if (r.length < 100) break;
  }
  return all;
});

export const listBranches = createServerFn({ method: "POST" })
  .inputValidator((d: { repo: string }) => d)
  .handler(async ({ data }) => {
    try {
      const r = await gh<any[]>(`repos/${data.repo}/branches?per_page=100`);
      return r.map((b) => b.name as string);
    } catch {
      return [];
    }
  });

export const getFiles = createServerFn({ method: "POST" })
  .inputValidator((d: { repo: string; branch: string; paths: string[] }) => d)
  .handler(async ({ data }) => {
    const out: Record<string, string | null> = {};
    for (const p of data.paths) {
      try {
        const f = await gh<{ content: string; encoding: string }>(
          `repos/${data.repo}/contents/${p.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(data.branch)}`,
        );
        const bin = atob(f.content.replace(/\n/g, ""));
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        out[p] = new TextDecoder().decode(bytes);
      } catch (e) {
        if ((e as { status?: number }).status === 404) out[p] = null;
        else throw e;
      }
    }
    return out;
  });

type FileOp = { path: string; base64?: string; delete?: boolean };

export const commitFiles = createServerFn({ method: "POST" })
  .inputValidator((d: { repo: string; branch: string; message: string; mode: "replace" | "merge"; files: FileOp[] }) => d)
  .handler(async ({ data }) => {
    const { repo, branch } = data;
    let parentSha: string | null = null;
    let baseTree: string | null = null;
    try {
      const ref = await gh<{ object: { sha: string } }>(`repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
      parentSha = ref.object.sha;
      const c = await gh<{ tree: { sha: string } }>(`repos/${repo}/git/commits/${parentSha}`);
      baseTree = c.tree.sha;
    } catch (e) {
      const st = (e as { status?: number }).status;
      if (st !== 404 && st !== 409) throw e;
      // Empty repo or new branch: try default branch as parent, else bootstrap.
      const info = await gh<{ default_branch: string }>(`repos/${repo}`);
      try {
        const ref = await gh<{ object: { sha: string } }>(`repos/${repo}/git/ref/heads/${info.default_branch}`);
        parentSha = ref.object.sha;
        const c = await gh<{ tree: { sha: string } }>(`repos/${repo}/git/commits/${parentSha}`);
        baseTree = c.tree.sha;
      } catch {
        // Fully empty repo: Git Data API needs one commit first.
        await gh(`repos/${repo}/contents/.lovable-init`, {
          method: "PUT",
          body: JSON.stringify({ message: "init", content: btoa("init"), branch }),
        });
        const ref = await gh<{ object: { sha: string } }>(`repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
        parentSha = ref.object.sha;
        baseTree = null;
      }
    }

    const writes = data.files.filter((f) => !f.delete);
    const tree: any[] = [];
    let i = 0;
    const worker = async () => {
      while (i < writes.length) {
        const f = writes[i++]!;
        const b = await gh<{ sha: string }>(`repos/${repo}/git/blobs`, {
          method: "POST",
          body: JSON.stringify({ content: f.base64 ?? "", encoding: "base64" }),
        });
        const exec = /\.(sh|bash)$/.test(f.path) || f.path.startsWith("bin/");
        tree.push({ path: f.path, mode: exec ? "100755" : "100644", type: "blob", sha: b.sha });
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    if (data.mode === "merge") {
      for (const f of data.files.filter((f) => f.delete)) tree.push({ path: f.path, mode: "100644", type: "blob", sha: null });
    }

    const newTree = await gh<{ sha: string }>(`repos/${repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify(data.mode === "merge" && baseTree ? { base_tree: baseTree, tree } : { tree }),
    });
    const commit = await gh<{ sha: string; html_url: string }>(`repos/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({ message: data.message, tree: newTree.sha, parents: parentSha ? [parentSha] : [] }),
    });
    try {
      await gh(`repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: commit.sha, force: true }),
      });
    } catch (e) {
      if ((e as { status?: number }).status !== 422) throw e;
      await gh(`repos/${repo}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }) });
    }
    return { sha: commit.sha, url: `https://github.com/${repo}/commit/${commit.sha}`, count: data.files.length };
  });
