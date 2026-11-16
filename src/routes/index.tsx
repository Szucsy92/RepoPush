import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { getMe, listRepos, listBranches, getFiles, commitFiles } from "@/lib/github.functions";
import { readZip, toBase64, patchTargets, applyPatchText, type LocalFile } from "@/lib/repo-files";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RepoPush — ZIP és patch feltöltés GitHubra" },
      { name: "description", content: "ZIP-ből vagy patch/diff fájlból közvetlenül frissítsd a saját GitHub repóidat." },
      { property: "og:title", content: "RepoPush — ZIP és patch feltöltés GitHubra" },
      { property: "og:description", content: "ZIP-ből vagy patch/diff fájlból közvetlenül frissítsd a saját GitHub repóidat." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

type Repo = { full_name: string; default_branch: string; private: boolean };

function Index() {
  const meFn = useServerFn(getMe);
  const reposFn = useServerFn(listRepos);
  const branchesFn = useServerFn(listBranches);
  const filesFn = useServerFn(getFiles);
  const commitFn = useServerFn(commitFiles);

  const [me, setMe] = useState<{ login: string; avatar: string } | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [filter, setFilter] = useState("");
  const [repo, setRepo] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState("");
  const [tab, setTab] = useState<"zip" | "patch">("zip");
  const [mode, setMode] = useState<"replace" | "merge">("replace");
  const [zipFiles, setZipFiles] = useState<LocalFile[]>([]);
  const [zipName, setZipName] = useState("");
  const [patch, setPatch] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  const add = (s: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString()}  ${s}`]);

  useEffect(() => {
    meFn().then(setMe).catch((e) => add(String(e.message ?? e)));
    reposFn().then(setRepos).catch((e) => add(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    if (!repo) return;
    const r = repos.find((x) => x.full_name === repo);
    setBranch(r?.default_branch ?? "main");
    branchesFn({ data: { repo } }).then(setBranches);
  }, [repo]);

  const shown = useMemo(() => repos.filter((r) => r.full_name.toLowerCase().includes(filter.toLowerCase())), [repos, filter]);
  const targets = useMemo(() => (tab === "patch" && patch.trim() ? safe(() => patchTargets(patch), []) : []), [patch, tab]);

  async function onZip(f: File | undefined) {
    if (!f) return;
    if (f.name.match(/\.(patch|diff)$/i)) {
      setTab("patch");
      setPatch(await f.text());
      return;
    }
    setBusy(true);
    try {
      const files = await readZip(f);
      setZipFiles(files);
      setZipName(f.name);
      add(`ZIP beolvasva: ${files.length} fájl`);
    } catch (e: any) {
      add(`ZIP hiba: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!repo || !branch) return add("Válassz repót és ágat.");
    setBusy(true);
    try {
      if (tab === "zip") {
        if (!zipFiles.length) throw new Error("Nincs ZIP betöltve.");
        add(`Feltöltés: ${zipFiles.length} fájl → ${repo}@${branch} (${mode === "replace" ? "teljes csere" : "beillesztés"})`);
        const r = await commitFn({
          data: { repo, branch, mode, message: message || `Upload ${zipName}`, files: zipFiles.map((f) => ({ path: f.path, base64: f.base64 })) },
        });
        add(`Kész ✔ ${r.count} fájl · ${r.url}`);
      } else {
        const t = patchTargets(patch);
        if (!t.length) throw new Error("A patch nem tartalmaz fájlt.");
        const paths = [...new Set(t.map((x) => x.oldPath).filter(Boolean) as string[])];
        add(`Patch: ${t.length} fájl, eredeti tartalom letöltése…`);
        const src = await filesFn({ data: { repo, branch, paths } });
        const { ops, errors } = applyPatchText(patch, src);
        errors.forEach((e) => add(e));
        if (errors.length) throw new Error("A patch nem minden része illeszthető, semmi sem lett feltöltve.");
        const r = await commitFn({
          data: {
            repo, branch, mode: "merge", message: message || "Apply patch",
            files: ops.map((o) => (o.delete ? { path: o.path, delete: true } : { path: o.path, base64: toBase64(o.content ?? "") })),
          },
        });
        add(`Kész ✔ ${r.count} módosítás · ${r.url}`);
      }
    } catch (e: any) {
      add(`Hiba: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="font-mono text-lg font-bold tracking-tight">
            <span className="text-primary">›</span> repopush
          </div>
          {me ? (
            <div className="flex items-center gap-2 font-mono text-sm text-muted-foreground">
              <img src={me.avatar} alt="" className="h-7 w-7 rounded-full" /> {me.login}
            </div>
          ) : (
            <span className="font-mono text-sm text-muted-foreground">kapcsolódás…</span>
          )}
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-3">
          <Label>Repó</Label>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Keresés…" className="field" />
          <div className="max-h-[420px] overflow-auto rounded-md border border-border">
            {shown.map((r) => (
              <button
                key={r.full_name}
                onClick={() => setRepo(r.full_name)}
                className={`block w-full truncate px-3 py-2 text-left font-mono text-sm transition-colors hover:bg-accent ${repo === r.full_name ? "bg-primary text-primary-foreground hover:bg-primary" : ""}`}
              >
                {r.private ? "🔒 " : ""}{r.full_name}
              </button>
            ))}
            {!repos.length && <div className="p-3 text-sm text-muted-foreground">Betöltés…</div>}
          </div>
          <Label>Ág</Label>
          <input list="branches" value={branch} onChange={(e) => setBranch(e.target.value)} className="field" placeholder="main" />
          <datalist id="branches">{branches.map((b) => <option key={b} value={b} />)}</datalist>
          <p className="text-xs text-muted-foreground">Új ág nevét is beírhatod – létrejön.</p>
        </aside>

        <section className="space-y-5">
          <div className="flex gap-1 rounded-md border border-border p-1 font-mono text-sm">
            {(["zip", "patch"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded px-3 py-2 ${tab === t ? "bg-secondary text-secondary-foreground" : "text-muted-foreground"}`}>
                {t === "zip" ? "ZIP feltöltés" : "Patch / Diff"}
              </button>
            ))}
          </div>

          {tab === "zip" ? (
            <>
              <label
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); onZip(e.dataTransfer.files[0]); }}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors ${drag ? "border-primary bg-accent" : "border-border hover:border-primary"}`}
              >
                <input type="file" accept=".zip,.patch,.diff" className="hidden" onChange={(e) => onZip(e.target.files?.[0])} />
                <div className="font-mono text-lg">{zipName || "Húzd ide a ZIP-et vagy kattints"}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {zipFiles.length ? `${zipFiles.length} fájl · a közös gyökérmappa automatikusan levágva` : "Letöltött repó szerkezet (pl. repo-main/…)"}
                </div>
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <ModeBtn on={mode === "replace"} onClick={() => setMode("replace")} title="Teljes csere" sub="A repó pontosan a ZIP tartalma lesz, ami nincs benne, törlődik." />
                <ModeBtn on={mode === "merge"} onClick={() => setMode("merge")} title="Beillesztés" sub="A ZIP fájljai felülírnak/hozzáadódnak, a többi marad." />
              </div>
              {zipFiles.length > 0 && (
                <div className="max-h-56 overflow-auto rounded-md border border-border bg-card p-3 font-mono text-xs text-muted-foreground">
                  {zipFiles.map((f) => <div key={f.path}>{f.path}</div>)}
                </div>
              )}
            </>
          ) : (
            <>
              <textarea
                value={patch}
                onChange={(e) => setPatch(e.target.value)}
                placeholder="Illeszd be a unified diff / git patch tartalmát, vagy húzz ide .patch / .diff fájlt"
                onDrop={async (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setPatch(await f.text()); }}
                className="field h-72 font-mono text-xs"
              />
              {targets.length > 0 && (
                <div className="rounded-md border border-border bg-card p-3 font-mono text-xs">
                  {targets.map((t, k) => (
                    <div key={k}>
                      {!t.oldPath ? <span className="text-primary">+ új </span> : !t.newPath ? <span className="text-destructive">− töröl </span> : t.oldPath !== t.newPath ? "↦ átnevez " : "~ módosít "}
                      {t.newPath ?? t.oldPath} {t.oldPath && t.newPath && t.oldPath !== t.newPath ? `(← ${t.oldPath})` : ""}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Commit üzenet (opcionális)" className="field" />
          <button
            disabled={busy || !repo}
            onClick={run}
            className="w-full rounded-md bg-primary px-4 py-3 font-mono font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Folyamatban…" : repo ? `Végrehajtás → ${repo}@${branch}` : "Válassz repót"}
          </button>

          <pre className="min-h-24 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-card p-3 font-mono text-xs text-muted-foreground">
            {log.length ? log.join("\n") : "Napló…"}
          </pre>
        </section>
      </div>
    </main>
  );
}

function safe<T>(f: () => T, d: T): T { try { return f(); } catch { return d; } }
function Label({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{children}</div>;
}
function ModeBtn({ on, onClick, title, sub }: { on: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button onClick={onClick} className={`rounded-md border p-3 text-left transition-colors ${on ? "border-primary bg-accent" : "border-border hover:border-primary"}`}>
      <div className="font-mono text-sm font-bold">{title}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </button>
  );
}
