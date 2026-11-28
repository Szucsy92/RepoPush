import { describe, expect, it, vi } from "vitest";
import { GitHub, gitBlobSha, planZip } from "@/lib/github";
import { saveToken, loadToken, clearToken } from "@/lib/token";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "x-ratelimit-limit": "5000", "x-ratelimit-remaining": "4999" } });

describe("GitHub client", () => {
  it("sends the token only to api.github.com with the required headers", async () => {
    const f = vi.fn(async () => ok({ login: "a", avatar_url: "x" }));
    await new GitHub("tok", f as any).getMe();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/user");
    const h = init.headers as Record<string, string>;
    expect(h["Authorization"]).toBe("Bearer tok");
    expect(h["Accept"]).toBe("application/vnd.github+json");
    expect(h["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("refuses to call any other host", async () => {
    const f = vi.fn();
    await expect(new GitHub("tok", f as any).req("https://evil.example/x")).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });

  it("explains an expired token in Hungarian", async () => {
    const f = async () => new Response('{"message":"Bad credentials"}', { status: 401 });
    await expect(new GitHub("t", f as any).getMe()).rejects.toThrow(/lejárt/);
  });

  it("reports rate limit exhaustion", async () => {
    const f = async () => new Response('{"message":"API rate limit exceeded"}', { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1" } });
    await expect(new GitHub("t", f as any).getMe()).rejects.toThrow(/korlát/);
  });
});

describe("repo tree", () => {
  it("reports blobs and the truncated flag", async () => {
    const f = async () => ok({ tree: [{ path: "a.txt", type: "blob", sha: "1", mode: "100644" }, { path: "d", type: "tree", sha: "2", mode: "040000" }, { path: "gradlew", type: "blob", sha: "3", mode: "100755" }], truncated: true });
    expect(await new GitHub("t", f as any).getTree("o/r", "main")).toEqual({ files: { "a.txt": "1", gradlew: "3" }, modes: { "a.txt": "100644", gradlew: "100755" }, truncated: true });
  });

  it("keeps the git mode of existing files and guesses only for new ones", async () => {
    const bodies: any[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url).pathname;
      if (u.endsWith("/git/ref/heads/main") && (!init || !init.method)) return ok({ object: { sha: "c0" } });
      if (u.endsWith("/git/commits/c0")) return ok({ tree: { sha: "t0" } });
      if (u.endsWith("/git/trees")) { bodies.push(JSON.parse(String(init!.body))); return ok({ sha: "t1" }); }
      if (u.endsWith("/git/commits")) return ok({ sha: "c1" });
      return ok({});
    });
    await new GitHub("t", f as any).commitFiles({
      repo: "o/r", branch: "main", message: "m", mode: "replace",
      files: [{ path: "gradlew", sha: "a", mode: "100755" }, { path: "docs/run", sha: "b", mode: "100644" }, { path: "new.sh", sha: "c" }, { path: "new.txt", sha: "d" }],
    });
    const modes = Object.fromEntries(bodies[0].tree.map((x: any) => [x.path, x.mode]));
    expect(modes).toEqual({ gradlew: "100755", "docs/run": "100644", "new.sh": "100755", "new.txt": "100644" });
  });
});

describe("runs overview", () => {
  const run = (id: number, status: string) => ({ id, name: "APK", event: "workflow_dispatch", status, conclusion: null, html_url: "u", created_at: "t", check_suite_id: 1 });

  it("does not look up the runs another tracker already follows", async () => {
    const urls: string[] = [];
    const f = vi.fn(async (url: string) => {
      const u = new URL(url).pathname;
      urls.push(u);
      if (u.endsWith("/actions/runs")) return ok({ workflow_runs: [run(1, "in_progress"), run(2, "in_progress")] });
      if (u.endsWith("/jobs")) return ok({ jobs: [] });
      return ok(run(Number(u.split("/").pop()), "in_progress"));
    });
    const { open } = await new GitHub("t", f as any).runsOverview("o/r", false, new Set([1]));
    expect(open.map((x) => x.id).sort()).toEqual([1, 2]);
    expect(urls.some((u) => u.endsWith("/runs/1") || u.endsWith("/runs/1/jobs"))).toBe(false);
    expect(urls.some((u) => u.endsWith("/runs/2"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/runs/2/jobs"))).toBe(true);
  });
});

describe("change plan", () => {
  it("counts added, modified, unchanged and (replace only) deleted files", async () => {
    const same = btoa("hello\n");
    const remote = { "a.txt": await gitBlobSha(same), "b.txt": "0".repeat(40), "old.txt": "1".repeat(40) };
    const files = [{ path: "a.txt", base64: same }, { path: "b.txt", base64: btoa("x") }, { path: "new.txt", base64: btoa("n") }];
    const p = await planZip(files, remote, "replace");
    expect(p).toEqual({ added: ["new.txt"], modified: ["b.txt"], deleted: ["old.txt"], unchanged: 1 });
    expect((await planZip(files, remote, "merge")).deleted).toEqual([]);
  });

  it("computes real git blob shas", async () => {
    expect(await gitBlobSha(btoa("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });
});

describe("token storage", () => {
  it("uses sessionStorage only when not remembered", () => {
    saveToken("s", false);
    expect(localStorage.length).toBe(0);
    expect(loadToken()).toBe("s");
    saveToken("l", true);
    expect(sessionStorage.length).toBe(0);
    clearToken();
    expect(loadToken()).toBeNull();
  });
});
