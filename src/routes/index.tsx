import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { getMe, listRepos, listBranches, getFiles, commitFiles, uploadBlobs } from "@/lib/github.functions";
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
  const blobsFn = useServerFn(uploadBlobs);
  const [stage, setStage] = useState<0 | 1 | 2 | 3 | -1>(0);
  const [pct, setPct] = useState(0);
  const [step, setStep] = useState("");

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
    setStage(1); setPct(0); setStep("Előkészítés"); setLog([]);
    add(`START → ${repo}@${branch}`);
    try {
      if (tab === "zip") {
        if (!zipFiles.length) throw new Error("Nincs ZIP betöltve.");
        add(`Feltöltés: ${zipFiles.length} fájl → ${repo}@${branch} (${mode === "replace" ? "teljes csere" : "beillesztés"})`);
        setStage(2);
        const done: { path: string; sha: string }[] = [];
        const B = 20;
        for (let k = 0; k < zipFiles.length; k += B) {
          const batch = zipFiles.slice(k, k + B);
          setStep(`Fájlok küldése ${k + batch.length}/${zipFiles.length}`);
          done.push(...(await blobsFn({ data: { repo, files: batch } })));
          batch.forEach((f) => add(`  ↑ ${f.path}`));
          setPct(Math.round(((k + batch.length) / zipFiles.length) * 90));
        }
        setStep("Commit létrehozása és ág frissítése");
        add("Commit létrehozása…");
        const r = await commitFn({
          data: { repo, branch, mode, message: message || `Upload ${zipName}`, files: done },
        });
        add(`FINISH ✔ ${r.count} fájl · ${r.url}`);
      } else {
        const t = patchTargets(patch);
        if (!t.length) throw new Error("A patch nem tartalmaz fájlt.");
        const paths = [...new Set(t.map((x) => x.oldPath).filter(Boolean) as string[])];
        setStage(2); setStep("Eredeti fájlok letöltése"); setPct(20);
        add(`Patch: ${t.length} fájl, eredeti tartalom letöltése…`);
        const src = await filesFn({ data: { repo, branch, paths } });
        const { ops, errors } = applyPatchText(patch, src);
        errors.forEach((e) => add(e));
        if (errors.length) throw new Error("A patch nem minden része illeszthető, semmi sem lett feltöltve.");
        ops.forEach((o) => add(`  ${o.delete ? "−" : "~"} ${o.path}`));
        setStep("Commit létrehozása és ág frissítése"); setPct(70);
        const r = await commitFn({
          data: {
            repo, branch, mode: "merge", message: message || "Apply patch",
            files: ops.map((o) => (o.delete ? { path: o.path, delete: true } : { path: o.path, base64: toBase64(o.content ?? "") })),
          },
        });
        add(`FINISH ✔ ${r.count} módosítás · ${r.url}`);
      }
      setStage(3); setPct(100); setStep("Kész");
    } catch (e: any) {
      add(`HIBA ✖ ${e.message ?? e}`);
      setStage(-1); setStep("Megszakadt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="font-mono font-bold"><span className="text-primary">›</span> repopush</div>
        <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          {me ? <><img src={me.avatar} alt="" className="h-5 w-5 rounded-full" />{me.login}</> : "kapcsolódás…"}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-2xl min-h-0 flex-1 flex-col gap-2 p-3">
        <div className="flex gap-2">
          <select value={repo} onChange={(e) => setRepo(e.target.value)} className="field min-w-0 flex-[2] font-mono text-xs">
            <option value="">{repos.length ? "Repó…" : "Betöltés…"}</option>
            {repos.map((r) => <option key={r.full_name} value={r.full_name}>{r.private ? "🔒 " : ""}{r.full_name.split("/")[1]}</option>)}
          </select>
          <input list="branches" value={branch} onChange={(e) => setBranch(e.target.value)} className="field min-w-0 flex-1 font-mono text-xs" placeholder="ág" />
          <datalist id="branches">{branches.map((b) => <option key={b} value={b} />)}</datalist>
        </div>

        <div className="flex gap-1 rounded-md border border-border p-0.5 font-mono text-xs">
          {(["zip", "patch"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded px-2 py-1.5 ${tab === t ? "bg-secondary text-secondary-foreground" : "text-muted-foreground"}`}>
              {t === "zip" ? "ZIP" : "Patch / Diff"}
            </button>
          ))}
        </div>

        {tab === "zip" ? (
          <>
            <label
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); onZip(e.dataTransfer.files[0]); }}
              className={`flex h-20 shrink-0 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-3 text-center ${drag ? "border-primary bg-accent" : "border-border"}`}
            >
              <input type="file" accept=".zip,.patch,.diff" className="hidden" onChange={(e) => onZip(e.target.files?.[0])} />
              <div className="truncate font-mono text-sm">{zipName || "ZIP behúzása / tallózás"}</div>
              <div className="text-xs text-muted-foreground">{zipFiles.length ? `${zipFiles.length} fájl` : "letöltött repó szerkezet"}</div>
            </label>
            <div className="flex gap-1 rounded-md border border-border p-0.5 font-mono text-xs">
              <button onClick={() => setMode("replace")} title="Ami nincs a ZIP-ben, törlődik" className={`flex-1 rounded px-2 py-1.5 ${mode === "replace" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Teljes csere</button>
              <button onClick={() => setMode("merge")} title="A többi fájl marad" className={`flex-1 rounded px-2 py-1.5 ${mode === "merge" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Beillesztés</button>
            </div>
          </>
        ) : (
          <>
            <textarea
              value={patch}
              onChange={(e) => setPatch(e.target.value)}
              placeholder="Diff / patch beillesztése vagy .patch fájl behúzása"
              onDrop={async (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setPatch(await f.text()); }}
              className="field h-28 shrink-0 resize-none font-mono text-xs"
            />
            {targets.length > 0 && (
              <div className="truncate font-mono text-xs text-muted-foreground">
                {targets.length} fájl: {targets.map((t) => t.newPath ?? t.oldPath).join(", ")}
              </div>
            )}
          </>
        )}

        <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Commit üzenet (opcionális)" className="field text-xs" />
        <button disabled={busy || !repo} onClick={run} className="truncate rounded-md bg-primary px-3 py-2.5 font-mono text-sm font-bold text-primary-foreground disabled:opacity-40">
          {busy ? "Folyamatban…" : repo ? `Végrehajtás → ${branch}` : "Válassz repót"}
        </button>
        <div className="shrink-0 space-y-1.5">
          <div className="flex items-center gap-1 font-mono text-[11px]">
            {["Start", "Process", "Finish"].map((n, k) => {
              const st = k + 1;
              const cls = stage === -1 && st >= 2 ? "border-destructive text-destructive" : stage > st || (stage === 3 && st === 3) ? "border-primary bg-primary text-primary-foreground" : stage === st ? "border-primary text-primary animate-pulse" : "border-border text-muted-foreground";
              return (
                <div key={n} className="flex flex-1 items-center gap-1">
                  <div className={`flex-1 rounded border px-2 py-1 text-center ${cls}`}>{n}</div>
                  {k < 2 && <span className="text-muted-foreground">→</span>}
                </div>
              );
            })}
          </div>
          <div className="h-1.5 overflow-hidden rounded bg-muted">
            <div className={`h-full transition-all ${stage === -1 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">{step || "Várakozás"}{pct ? ` · ${pct}%` : ""}</div>
        </div>
        <pre ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-card p-2 font-mono text-[10px] text-muted-foreground">
          {log.length ? log.join("\n") : "Napló…"}
        </pre>
      </div>
    </main>
  );
}

function safe<T>(f: () => T, d: T): T { try { return f(); } catch { return d; } }
