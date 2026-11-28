// Direct, browser-side GitHub REST client. The token is passed in explicitly and is only
// ever sent to API (https://api.github.com). Never log it or put it into a URL.
export const API = "https://api.github.com";
export type ReleaseAsset = { name: string; url: string; size: number };
export type LatestRelease = { id: string; tag: string; name: string; published: string; assets: ReleaseAsset[] };

const REQUEST_TIMEOUT_MS = 25_000;

export class GitHubError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export type Repo = { full_name: string; default_branch: string; private: boolean };
export type FileOp = { path: string; base64?: string; sha?: string; mode?: string; delete?: boolean };
export type Step = { name: string; status: string; conclusion: string | null };
export type Job = { name: string; status: string; conclusion: string | null; url: string; steps: Step[] };
export type Run = { id: number; suite: number; name: string; event: string; status: string; conclusion: string | null; url: string; created?: string; jobs: Job[] };
export type RunBrief = { id: number; name: string; event: string; status: string; conclusion: string | null; url: string; created: string };

export function friendlyError(status: number, body: string, h: Headers): string {
  let msg = "";
  try { msg = (JSON.parse(body) as { message?: string }).message ?? ""; } catch { msg = body.slice(0, 200); }
  const remaining = h.get("x-ratelimit-remaining");
  const reset = Number(h.get("x-ratelimit-reset") ?? 0);
  if ((status === 403 || status === 429) && (remaining === "0" || /rate limit/i.test(msg))) {
    const when = reset ? new Date(reset * 1000).toLocaleTimeString("hu-HU") : "később";
    return `Elérted a GitHub kérés-korlátját. Újra próbálhatod ekkor: ${when}.`;
  }
  if (status === 401) return "A token érvénytelen vagy lejárt. Jelentkezz ki, és adj meg új tokent.";
  if (status === 403) return `Hiányzó jogosultság: a token nem engedi ezt a műveletet (Contents / Actions / Workflows írás kell). ${msg}`.trim();
  if (status === 404) return `Nem található (vagy a tokennek nincs hozzáférése ehhez a repóhoz). ${msg}`.trim();
  return `GitHub hiba [${status}]: ${msg}`;
}

function enc(p: string) { return p.split("/").map(encodeURIComponent).join("/"); }

export class GitHub {
  rate: { remaining: number; limit: number; reset: number } | null = null;
  constructor(private token: string, private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  /** Bármelyik repó legfrissebb release-e a letölthető fájlokkal (APK-k elöl); null, ha nincs release vagy fájl. */
  async latestRelease(repo: string): Promise<LatestRelease | null> {
    try {
      const r = await this.req<{ id: number; tag_name: string; name: string | null; published_at: string; assets: { name: string; size: number; browser_download_url: string }[] }>(`repos/${repo}/releases/latest`);
      const assets = r.assets
        .map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size }))
        .sort((x, y) => Number(y.name.endsWith(".apk")) - Number(x.name.endsWith(".apk")));
      return assets.length ? { id: String(r.id), tag: r.tag_name, name: r.name || r.tag_name, published: r.published_at, assets } : null;
    } catch {
      return null;
    }
  }

  async req<T = any>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.raw(path, init);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(path.replace(/^\//, ""), API + "/");
    if (url.origin !== API) throw new Error("Csak az api.github.com hívható.");
    // A GitHub API válaszai 60 mp-ig gyorsítótárazhatók: ettől maradt „beragadva” a régi állapot. Mindig friss kell.
    // Lekérdezésekre (nincs törzs) időkorlát: egy elakadt kérés ne fagyassza be a követést és a frissítést.
    const ctl = !init.signal && !init.body ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS) : undefined;
    let res: Response;
    try {
      res = await this.fetchImpl(url.href, {
        cache: "no-store",
        ...(ctl ? { signal: ctl.signal } : {}),
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          Authorization: `Bearer ${this.token}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
      });
    } catch (e) {
      if (ctl?.signal.aborted) throw new GitHubError("Időtúllépés: a GitHub nem válaszolt időben, próbáld újra.", 0);
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
    const lim = res.headers.get("x-ratelimit-limit");
    if (lim) this.rate = { limit: +lim, remaining: +(res.headers.get("x-ratelimit-remaining") ?? 0), reset: +(res.headers.get("x-ratelimit-reset") ?? 0) };
    if (!res.ok) throw new GitHubError(friendlyError(res.status, await res.text(), res.headers), res.status);
    return res;
  }

  async getMe() {
    const u = await this.req<{ login: string; avatar_url: string }>("user");
    return { login: u.login, avatar: u.avatar_url };
  }

  async listRepos(): Promise<Repo[]> {
    const all: Repo[] = [];
    for (let page = 1; page <= 10; page++) {
      const r = await this.req<any[]>(`user/repos?per_page=100&sort=updated&page=${page}`);
      all.push(...r.map((x) => ({ full_name: x.full_name, default_branch: x.default_branch, private: x.private })));
      if (r.length < 100) break;
    }
    return all;
  }

  async listBranches(repo: string): Promise<string[]> {
    try {
      const r = await this.req<any[]>(`repos/${repo}/branches?per_page=100`);
      return r.map((b) => b.name as string);
    } catch { return []; }
  }

  /**
   * Path → blob sha of the current branch tree (empty when branch/repo is empty). `modes` = the git file mode of each blob
   * (100644 file, 100755 executable, 120000 symlink): a commit that rewrites a file must keep it, or e.g. `gradlew` loses its
   * executable bit. `truncated` = GitHub cut the listing (huge repo).
   */
  async getTree(repo: string, branch: string): Promise<{ files: Record<string, string>; modes: Record<string, string>; truncated: boolean }> {
    try {
      const t = await this.req<{ tree: { path: string; type: string; sha: string; mode?: string }[]; truncated?: boolean }>(`repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
      const blobs = t.tree.filter((x) => x.type === "blob");
      return {
        files: Object.fromEntries(blobs.map((x) => [x.path, x.sha])),
        modes: Object.fromEntries(blobs.filter((x) => x.mode).map((x) => [x.path, x.mode as string])),
        truncated: !!t.truncated,
      };
    } catch (e) {
      if (e instanceof GitHubError && (e.status === 404 || e.status === 409)) return { files: {}, modes: {}, truncated: false };
      throw e;
    }
  }

  async getFiles(repo: string, branch: string, paths: string[]) {
    const out: Record<string, string | null> = {};
    for (const p of paths) {
      try {
        const f = await this.req<{ content: string }>(`repos/${repo}/contents/${enc(p)}?ref=${encodeURIComponent(branch)}`);
        const bytes = Uint8Array.from(atob(f.content.replace(/\n/g, "")), (c) => c.charCodeAt(0));
        out[p] = new TextDecoder().decode(bytes);
      } catch (e) {
        if (e instanceof GitHubError && e.status === 404) out[p] = null;
        else throw e;
      }
    }
    return out;
  }

  async uploadBlobs(repo: string, files: { path: string; base64: string }[]) {
    return Promise.all(files.map(async (f) => {
      const b = await this.req<{ sha: string }>(`repos/${repo}/git/blobs`, { method: "POST", body: JSON.stringify({ content: f.base64, encoding: "base64" }) });
      return { path: f.path, sha: b.sha };
    }));
  }

  private async head(repo: string, branch: string) {
    const ref = await this.req<{ object: { sha: string } }>(`repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    const c = await this.req<{ tree: { sha: string } }>(`repos/${repo}/git/commits/${ref.object.sha}`);
    return { parent: ref.object.sha, tree: c.tree.sha as string | null };
  }

  async commitFiles(d: { repo: string; branch: string; message: string; mode: "replace" | "merge"; files: FileOp[] }) {
    const { repo, branch } = d;
    let base: { parent: string; tree: string | null };
    try { base = await this.head(repo, branch); } catch (e) {
      if (!(e instanceof GitHubError) || (e.status !== 404 && e.status !== 409)) throw e;
      const info = await this.req<{ default_branch: string }>(`repos/${repo}`);
      try { base = await this.head(repo, info.default_branch); } catch {
        // Empty repository: the Git Data API needs one commit first.
        await this.req(`repos/${repo}/contents/.repopush-init`, { method: "PUT", body: JSON.stringify({ message: "init", content: btoa("init"), branch }) });
        const ref = await this.req<{ object: { sha: string } }>(`repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
        base = { parent: ref.object.sha, tree: null };
      }
    }
    const writes = d.files.filter((f) => !f.delete);
    const tree: any[] = [];
    let i = 0;
    const worker = async () => {
      while (i < writes.length) {
        const f = writes[i++]!;
        const sha = f.sha ?? (await this.req<{ sha: string }>(`repos/${repo}/git/blobs`, { method: "POST", body: JSON.stringify({ content: f.base64 ?? "", encoding: "base64" }) })).sha;
        // A már létező fájl megtartja a módját (futtatható bit, szimbolikus link); csak az újnál találgatunk a név alapján.
        const exec = /\.(sh|bash)$/.test(f.path) || f.path.startsWith("bin/");
        tree.push({ path: f.path, mode: f.mode ?? (exec ? "100755" : "100644"), type: "blob", sha });
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    if (d.mode === "merge") for (const f of d.files.filter((f) => f.delete)) tree.push({ path: f.path, mode: "100644", type: "blob", sha: null });
    // Nincs mit írni (a tartalom már így van a repóban, vagy üres a módosításlista): a fa ugyanaz marad, így üres commit készül,
    // ami a push-ra figyelő workflow-kat újra elindítja. Az ismétlés tehát mindig végrehajtható.
    if (!tree.length && !(d.mode === "merge" && base.tree)) throw new GitHubError("Nincs mit commitolni: üres a módosításlista és a repó is.", 0);
    const newTree = !tree.length
      ? { sha: base.tree as string }
      : await this.req<{ sha: string }>(`repos/${repo}/git/trees`, {
          method: "POST", body: JSON.stringify(d.mode === "merge" && base.tree ? { base_tree: base.tree, tree } : { tree }),
        });
    const commit = await this.req<{ sha: string }>(`repos/${repo}/git/commits`, {
      method: "POST", body: JSON.stringify({ message: d.message, tree: newTree.sha, parents: [base.parent] }),
    });
    const moveRef = async () => {
      try {
        await this.req(`repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: true }) });
      } catch (e) {
        if (!(e instanceof GitHubError) || e.status !== 422) throw e;
        await this.req(`repos/${repo}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }) });
      }
    };
    try {
      await moveRef();
    } catch (e) {
      // A kapcsolat megszakadhat, miután a GitHub már végrehajtotta a kérést (a válasz nem érkezik meg, „Failed to fetch”):
      // ha az ág már az új commitra mutat, a feltöltés sikerült, és nem szabad hibát jelezni.
      const lostReply = !(e instanceof GitHubError) || e.status === 0 || e.status >= 500;
      if (!lostReply) throw e;
      await new Promise((r) => setTimeout(r, 1500));
      const now = await this.req<{ object: { sha: string } }>(`repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`).then((x) => x.object.sha, () => null);
      if (now !== commit.sha) throw e;
    }
    return { sha: commit.sha, url: `https://github.com/${repo}/commit/${commit.sha}`, count: d.files.length, empty: !!base.tree && newTree.sha === base.tree };
  }

  async startBuild(repo: string, branch: string) {
    const w = await this.req<{ workflows: { id: number; name: string; state: string }[] }>(`repos/${repo}/actions/workflows?per_page=100`);
    const started: string[] = [], skipped: string[] = [];
    for (const wf of w.workflows.filter((x) => x.state === "active")) {
      try {
        await this.req(`repos/${repo}/actions/workflows/${wf.id}/dispatches`, { method: "POST", body: JSON.stringify({ ref: branch }) });
        started.push(wf.name);
      } catch { skipped.push(wf.name); }
    }
    return { started, skipped, total: w.workflows.length };
  }

  /** `skip`: azokat a futásokat, amiket más követő már lekérdez, itt nem kérjük le újra (a jobjaik nélkül adjuk vissza). */
  private async withJobs(repo: string, runs: any[], skip: ReadonlySet<number> = new Set()): Promise<Run[]> {
    return Promise.all(runs.map(async (run) => {
      const j = skip.has(run.id) ? { jobs: [] as any[] } : await this.req<{ jobs: any[] }>(`repos/${repo}/actions/runs/${run.id}/jobs`);
      return {
        id: run.id, suite: run.check_suite_id, name: run.name, event: run.event, status: run.status, conclusion: run.conclusion, url: run.html_url, created: run.created_at,
        jobs: j.jobs.map((x) => ({
          name: x.name, status: x.status, conclusion: x.conclusion, url: x.html_url,
          steps: (x.steps ?? []).map((s: any) => ({ name: s.name, status: s.status, conclusion: s.conclusion })),
        })),
      };
    }));
  }

  /**
   * Futó workflow-futás leállítása. A kényszerített változat az elakadt („cancelling” állapotban ragadt) futásokhoz kell.
   * Ha a futás közben lezárult, a GitHub 409-et ad (GitHubError.status).
   */
  async cancelRun(repo: string, id: number, force = false): Promise<void> {
    await this.raw(`repos/${repo}/actions/runs/${id}/${force ? "force-cancel" : "cancel"}`, { method: "POST" });
  }

  /** A listában látszó állapot elavulhat („szellem” queued futás): a nyitottnak látszó futásokat a saját végpontjukon ellenőrizzük. */
  private async verifyOpen(repo: string, runs: any[]): Promise<any[]> {
    return Promise.all(runs.map((x) => (x.status === "completed" ? x : this.req<any>(`repos/${repo}/actions/runs/${x.id}`).catch(() => x))));
  }

  async buildStatus(repo: string, branch: string, since: string): Promise<Run[]> {
    const r = await this.req<{ workflow_runs: any[] }>(`repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&created=${encodeURIComponent(">=" + since)}&per_page=20`);
    return this.withJobs(repo, await this.verifyOpen(repo, r.workflow_runs));
  }

  /**
   * Az épp nyitott (sorban álló, futó, várakozó) action-ök bármilyen ágon, bárki indította, és a legutóbb lezárultak.
   * `skip` = a build-követő által már követett futások azonosítói: ezekre nincs külön ellenőrzés és jobok lekérése.
   * Az állapotra szűrt lista (?status=queued) elavult is lehet: egy már megszakadt vagy lefutott futást még sorban állónak
   * mutat („szellem” futás). Ezért a nyitottnak látszó futásokat mindig a futás saját végpontján ellenőrizzük.
   */
  async runsOverview(repo: string, deep = true, skip: ReadonlySet<number> = new Set()): Promise<{ open: Run[]; closed: RunBrief[] }> {
    const none = { workflow_runs: [] as any[] };
    const [recent, queued, running] = await Promise.all([
      this.req<{ workflow_runs: any[] }>(`repos/${repo}/actions/runs?per_page=30`),
      deep ? this.req<{ workflow_runs: any[] }>(`repos/${repo}/actions/runs?status=queued&per_page=10`).catch(() => none) : Promise.resolve(none),
      deep ? this.req<{ workflow_runs: any[] }>(`repos/${repo}/actions/runs?status=in_progress&per_page=10`).catch(() => none) : Promise.resolve(none),
    ]);
    const done = new Map<number, any>();
    const candidates = new Map<number, any>();
    recent.workflow_runs.forEach((x) => (x.status === "completed" ? done : candidates).set(x.id, x));
    [...queued.workflow_runs, ...running.workflow_runs].forEach((x) => { if (!done.has(x.id)) candidates.set(x.id, x); });
    // A `skip` futásait (a build-követő saját futásai) a követőjük már ellenőrzi és a jobjaikat is lekéri: itt ez kétszeres kérés lenne.
    const fresh = await Promise.all([...candidates.values()].map((x) => (skip.has(x.id) ? x : this.req<any>(`repos/${repo}/actions/runs/${x.id}`).catch(() => x))));
    const open: any[] = [];
    fresh.forEach((x) => { if (x.status === "completed") done.set(x.id, x); else open.push(x); });
    const brief = (x: any): RunBrief => ({ id: x.id, name: x.name, event: x.event, status: x.status, conclusion: x.conclusion, url: x.html_url, created: x.created_at });
    return { open: await this.withJobs(repo, open, skip), closed: [...done.values()].map(brief) };
  }

  /** Ismert futások aktuális állapota (pl. a végeredményük). */
  async getRuns(repo: string, ids: number[]): Promise<Run[]> {
    const runs = await Promise.all(ids.map((id) => this.req<any>(`repos/${repo}/actions/runs/${id}`)));
    return this.withJobs(repo, runs);
  }
}

/** Git blob sha-1, to detect unchanged files without downloading them. */
export async function gitBlobSha(base64: string): Promise<string> {
  const body = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const head = new TextEncoder().encode(`blob ${body.length}\0`);
  const all = new Uint8Array(head.length + body.length);
  all.set(head); all.set(body, head.length);
  const h = await crypto.subtle.digest("SHA-1", all);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type Plan = { added: string[]; modified: string[]; deleted: string[]; unchanged: number };

export async function planZip(files: { path: string; base64: string }[], remote: Record<string, string>, mode: "replace" | "merge"): Promise<Plan> {
  const p: Plan = { added: [], modified: [], deleted: [], unchanged: 0 };
  const local = new Set<string>();
  for (const f of files) {
    local.add(f.path);
    const r = remote[f.path];
    if (!r) p.added.push(f.path);
    else if (r !== (await gitBlobSha(f.base64))) p.modified.push(f.path);
    else p.unchanged++;
  }
  if (mode === "replace") p.deleted = Object.keys(remote).filter((k) => !local.has(k));
  return p;
}
