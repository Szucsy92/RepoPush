import { useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { GitHub, planZip, type LatestRelease, type Plan, type Repo, type Run } from "@/lib/github";
import { readZip, toBase64, patchTargets, applyPatchText, type LocalFile } from "@/lib/repo-files";
import { loadToken, loadLegacyToken, clearToken } from "@/lib/token";
import { hasVault } from "@/lib/lock";
import { isNative } from "@/lib/native";
import { markSeen, seenRelease } from "@/lib/seen";
import { TokenScreen } from "@/TokenScreen";
import { PinSetup, LockScreen } from "@/PinScreens";
import { ConfirmDialog } from "@/ConfirmDialog";


export default function App() {
  const [me, setMe] = useState<{ login: string; avatar: string } | null>(null);
  const [token, setToken] = useState<string | null>(() => loadToken());
  // Token that still needs a PIN: just entered, or a plain-text one an older version left behind.
  const [pending, setPending] = useState<string | null>(() => loadLegacyToken());
  const logout = () => { clearToken(); setToken(null); setPending(null); setMe(null); };
  if (token) return <Main key={token} token={token} me={me} setMe={setMe} onLogout={logout} />;
  if (pending) return <PinSetup token={pending} onDone={(t) => { setPending(null); setToken(t); }} onBack={logout} />;
  if (hasVault()) return <LockScreen onUnlock={setToken} onForgot={logout} />;
  return <TokenScreen onDone={(t, u, remember) => { setMe(u); if (remember) setPending(t); else setToken(t); }} />;
}

function Main({ token, me, setMe, onLogout }: { token: string; me: { login: string; avatar: string } | null; setMe: (m: { login: string; avatar: string }) => void; onLogout: () => void }) {
  const gh = useMemo(() => new GitHub(token), [token]);
  const [confirm, setConfirm] = useState<{ plan: Plan; resolve: (ok: boolean) => void } | null>(null);
  const ask = (plan: Plan) => new Promise<boolean>((resolve) => setConfirm({ plan, resolve }));
  const [since, setSince] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [building, setBuilding] = useState(false);
  const [stage, setStage] = useState<0 | 1 | 2 | 3 | -1>(0);
  const [pct, setPct] = useState(0);
  const [step, setStep] = useState("");

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
  const [release, setRelease] = useState<LatestRelease | null>(null);
  const [relTick, setRelTick] = useState(0);
  const [pollTick, setPollTick] = useState(0);
  const phases = useRef<Record<string, string>>({});
  const [seenId, setSeenId] = useState<string | undefined>();
  const [active, setActive] = useState<Run[]>([]);
  const [logTab, setLogTab] = useState<"log" | "action">("log");
  const activeRef = useRef<Run[]>([]);
  const buildingRef = useRef(false);
  const pokeRef = useRef<(() => void) | null>(null);
  const [drag, setDrag] = useState(false);
  const add = (s: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString()}  ${s}`]);

  useEffect(() => {
    gh.getMe().then(setMe).catch((e) => add(String(e.message ?? e)));
    gh.listRepos().then(setRepos).catch((e) => add(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    if (!repo) return;
    const r = repos.find((x) => x.full_name === repo);
    setBranch(r?.default_branch ?? "main");
    gh.listBranches(repo).then(setBranches);
  }, [repo]);

  // Az épp kiválasztott repó legfrissebb release-e; build végén újratöltjük.
  useEffect(() => { setRelease(null); }, [repo]);
  useEffect(() => {
    if (!repo) return;
    let alive = true;
    gh.latestRelease(repo).then((r) => { if (alive) setRelease(r); });
    return () => { alive = false; };
  }, [gh, repo, relTick]);
  // Automatikus frissítés: percenként és az appba visszalépéskor, hogy ne ragadjon be a régi állapot.
  useEffect(() => {
    if (!repo) return;
    const bump = () => { if (document.visibilityState === "visible") setRelTick((n) => n + 1); };
    const iv = setInterval(bump, 60000);
    document.addEventListener("visibilitychange", bump);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", bump); };
  }, [repo]);

  useEffect(() => { buildingRef.current = building; }, [building]);
  useEffect(() => { setSeenId(repo ? seenRelease(repo) : undefined); }, [repo, release]);

  // Az építés-panelben már követett futások azonosítói: ezeket a figyelő nem jelzi külön.
  const panelIds = useRef<Set<number>>(new Set());
  useEffect(() => { panelIds.current = new Set(runs.map((x) => x.id)); }, [runs]);

  // Futó action figyelése: csak az a futás kap „Action folyamatban” fület, ami a repó megnyitásakor
  // (pl. az app újranyitása után) már futott. Ami az appból indult, azt a build-panel mutatja.
  useEffect(() => {
    setActive([]); setLogTab("log"); activeRef.current = [];
    if (!repo) return;
    let alive = true;
    let first = true;
    const tracked = new Set<number>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!alive) return;
      let delay = 30000;
      if (document.visibilityState === "visible") {
        try {
          const now = await gh.activeRuns(repo);
          if (!alive) return;
          if (first) {
            first = false;
            now.filter((x) => !panelIds.current.has(x.id)).forEach((x) => tracked.add(x.id));
            if (tracked.size) add(`Futó action: ${now.filter((x) => tracked.has(x.id)).map((x) => x.name).join(", ")} · nyisd meg az „Action” fület`);
          }
          const mine = now.filter((x) => tracked.has(x.id));
          const prev = activeRef.current;
          if (prev.length && !mine.length) {
            const done = await gh.getRuns(repo, prev.map((x) => x.id)).catch(() => []);
            if (!alive) return;
            add(`ACTION KÉSZ: ${done.map((x) => `${x.name} → ${x.conclusion ?? x.status}`).join(", ") || "lefutott"}`);
            tracked.clear();
            setLogTab("log");
            setRelTick((n) => n + 1);
          }
          activeRef.current = mine;
          setActive(mine);
          if (mine.length) delay = 8000;
        } catch { /* hálózati hiba: a következő körben újra */ }
      }
      if (alive) timer = setTimeout(tick, delay);
    };
    const wake = () => { if (document.visibilityState === "visible") { if (timer) clearTimeout(timer); tick(); } };
    pokeRef.current = wake;
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      pokeRef.current = null;
    };
  }, [gh, repo]);

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

  useEffect(() => {
    if (!since) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const t0 = Date.now();
    const tick = async () => {
      if (stop) return;
      try {
        const r = await gh.buildStatus(repo, branch, since);
        if (stop) return;
        setRuns(r);
        logPhases(r);
        const done = r.length > 0 && r.every((x) => x.status === "completed");
        if (done) { setBuilding(false); add(`BUILD KÉSZ: ${r.map((x) => `${x.name} → ${x.conclusion}`).join(", ")}`); setRelTick((n) => n + 1); return; }
        // Ne ragadjon be: ha 2 percig nem indult futás, vagy 45 percnél tovább tart, feladjuk a várakozást.
        if (!r.length && Date.now() - t0 > 120000) { setBuilding(false); add("Nem indult build ebben a 2 percben. Nézd meg az Actions oldalt, vagy indíts újat."); return; }
        if (Date.now() - t0 > 45 * 60000) { setBuilding(false); add("A build követése időtúllépés miatt leállt (45 perc). A ↻ gombbal újra lekérdezheted."); return; }
      } catch (e: any) { add(`Build állapot hiba: ${e.message}`); }
      if (!stop) timer = setTimeout(tick, 4000);
    };
    // Visszalépéskor azonnal újra lekérdez (a háttérben az időzítők lassulnak).
    const wake = () => { if (document.visibilityState === "visible") { if (timer) clearTimeout(timer); tick(); } };
    document.addEventListener("visibilitychange", wake);
    tick();
    return () => { stop = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", wake); };
  }, [since, pollTick]);

  // Az új build fázisait folyamatosan a naplóba írja (csak a változásokat).
  function logPhases(rs: Run[]) {
    const ph = phases.current;
    const note = (k: string, v: string, line: string) => { if (ph[k] !== v) { ph[k] = v; add(line); } };
    rs.forEach((x) => {
      const st = x.conclusion ?? x.status;
      note(`r${x.id}`, st, `${x.name}: ${st === "queued" ? "sorban áll" : st === "in_progress" ? "fut" : st}`);
      x.jobs.forEach((j) => {
        const total = j.steps.length;
        j.steps.forEach((st2, i) => {
          if (st2.status === "in_progress") note(`${x.id}/${j.name}/${i}`, "run", `  ▶ ${j.name} · ${st2.name} (${i + 1}/${total})`);
          else if (st2.status === "completed" && st2.conclusion && !["success", "skipped"].includes(st2.conclusion)) note(`${x.id}/${j.name}/${i}`, st2.conclusion, `  ✖ ${j.name} · ${st2.name}: ${st2.conclusion}`);
        });
      });
    });
  }

  // Kézi frissítés: release, futó action és (ha követünk buildet) a build állapota is.
  function refresh() {
    setRelTick((n) => n + 1);
    setPollTick((n) => n + 1);
    pokeRef.current?.();
  }

  async function build() {
    setBuilding(true); setRuns([]); phases.current = {}; setLogTab("log");
    const t = new Date(Date.now() - 5000).toISOString().replace(/\.\d+Z$/, "Z");
    try {
      const r = await gh.startBuild(repo, branch);
      add(`BUILD START → ${r.started.length ? r.started.join(", ") : "nincs kézzel indítható workflow, a feltöltés által indítottakat követem"}`);
      if (r.skipped.length) add(`  (kihagyva, nincs workflow_dispatch: ${r.skipped.join(", ")})`);
      setSince(""); setTimeout(() => setSince(t), 3000);
    } catch (e: any) { add(`Build hiba: ${e.message}`); setBuilding(false); }
  }

  // The full log ZIP is a plain github.com link: the browser's own GitHub session does the download
  // (the API route redirects to blob storage, which the app's CSP blocks on purpose).
  const logZip = (x: Run) => `https://github.com/${repo}/suites/${x.suite}/logs`;

  // Full repo ZIP of the selected branch: a plain github.com link, same reasoning as logZip
  // (the API zipball redirects to codeload.github.com, which the app's CSP blocks on purpose).
  const repoZip = repo && branch ? `https://github.com/${repo}/archive/refs/heads/${branch.split("/").map(encodeURIComponent).join("/")}.zip` : "";

  function details(x: Run) {
    add(`${x.name}: ${x.conclusion ?? x.status}`);
    x.jobs.forEach((j) => {
      add(`  ${j.name}: ${j.conclusion ?? j.status} · ${j.url}`);
      j.steps.filter((s) => s.conclusion && s.conclusion !== "success" && s.conclusion !== "skipped").forEach((s) => add(`    ✖ ${s.name}: ${s.conclusion}`));
    });
    add(`  Teljes napló (ZIP): ${logZip(x)}`);
    add(`  Futás oldala: ${x.url}`);
  }

  async function saveLog() {
    // Blob downloads do not work inside the Android WebView, so copy the log instead.
    if (isNative()) {
      try { await navigator.clipboard.writeText(log.join("\n")); add("A napló a vágólapra másolva."); } catch { add("A vágólapra másolás nem sikerült."); }
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([log.join("\n")], { type: "text/plain" }));
    a.download = "repopush-naplo.txt";
    a.click();
  }

  async function run() {
    if (!repo || !branch) return add("Válassz repót és ágat.");
    setBusy(true);
    setStage(1); setPct(0); setStep("Előkészítés"); setLog([]); setSince(""); setRuns([]);
    add(`START → ${repo}@${branch}`);
    try {
      if (tab === "zip") {
        if (!zipFiles.length) throw new Error("Nincs ZIP betöltve.");
        add(`Feltöltés: ${zipFiles.length} fájl → ${repo}@${branch} (${mode === "replace" ? "teljes csere" : "beillesztés"})`);
        setStep("Összevetés a repó jelenlegi állapotával");
        const { files: remote, truncated } = await gh.getTree(repo, branch);
        if (truncated && mode === "replace") throw new Error("A repó túl nagy a teljes összevetéshez (a GitHub csonkolta a fájllistát), ezért teljes cserét nem végzek. Használd a Beillesztés módot.");
        const plan = await planZip(zipFiles, remote, mode);
        if (!plan.added.length && !plan.modified.length && !plan.deleted.length) {
          add("Nincs változás: a ZIP megegyezik a repó jelenlegi állapotával, nem készült commit.");
          setStage(3); setPct(100); setStep("Nincs változás");
          return;
        }
        if (!(await ask(plan))) throw new Error("Megszakítva.");
        setStage(2);
        // Unchanged files keep their existing blob: no need to upload them again.
        const dirty = new Set([...plan.added, ...plan.modified]);
        const toSend = zipFiles.filter((f) => dirty.has(f.path));
        const done: { path: string; sha: string }[] = zipFiles.filter((f) => !dirty.has(f.path) && remote[f.path]).map((f) => ({ path: f.path, sha: remote[f.path]! }));
        const B = 20;
        for (let k = 0; k < toSend.length; k += B) {
          const batch = toSend.slice(k, k + B);
          setStep(`Fájlok küldése ${k + batch.length}/${toSend.length}`);
          done.push(...(await gh.uploadBlobs(repo, batch)));
          batch.forEach((f) => add(`  ↑ ${f.path}`));
          setPct(Math.round(((k + batch.length) / toSend.length) * 90));
        }
        setStep("Commit létrehozása és ág frissítése");
        add("Commit létrehozása…");
        const r = await gh.commitFiles({ repo, branch, mode, message: message || `Upload ${zipName}`, files: done });
        add(`FINISH ✔ ${r.count} fájl · ${r.url}`);
      } else {
        const t = patchTargets(patch);
        if (!t.length) throw new Error("A patch nem tartalmaz fájlt.");
        const paths = [...new Set(t.map((x) => x.oldPath).filter(Boolean) as string[])];
        setStage(2); setStep("Eredeti fájlok letöltése"); setPct(20);
        add(`Patch: ${t.length} fájl, eredeti tartalom letöltése…`);
        const src = await gh.getFiles(repo, branch, paths);
        const { ops, errors } = applyPatchText(patch, src);
        errors.forEach((e) => add(e));
        if (errors.length) throw new Error("A patch nem minden része illeszthető, semmi sem lett feltöltve.");
        ops.forEach((o) => add(`  ${o.delete ? "−" : "~"} ${o.path}`));
        const pl: Plan = { added: [], modified: [], deleted: [], unchanged: 0 };
        ops.forEach((o) => (o.delete ? pl.deleted : src[o.path] == null ? pl.added : pl.modified).push(o.path));
        if (!(await ask(pl))) throw new Error("Megszakítva.");
        setStep("Commit létrehozása és ág frissítése"); setPct(70);
        const r = await gh.commitFiles({
          repo, branch, mode: "merge", message: message || "Apply patch",
          files: ops.map((o) => (o.delete ? { path: o.path, delete: true } : { path: o.path, base64: toBase64(o.content ?? "") })),
        });
        add(`FINISH ✔ ${r.count} módosítás · ${r.url}`);
      }
      setStage(3); setPct(100); setStep("Kész");
      setTimeout(() => pokeRef.current?.(), 5000);
    } catch (e: any) {
      add(`HIBA ✖ ${e.message ?? e}`);
      setStage(-1); setStep("Megszakadt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    {confirm && <ConfirmDialog plan={confirm.plan} repo={repo} branch={branch} mode={tab === "patch" ? "patch" : mode === "replace" ? "teljes csere" : "beillesztés"}
      onOk={() => { confirm.resolve(true); setConfirm(null); }} onCancel={() => { confirm.resolve(false); setConfirm(null); }} />}
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="font-mono font-bold"><span className="text-primary">›</span> repopush</div>
        <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          {me ? <><img src={me.avatar} alt="" className="h-5 w-5 rounded-full" />{me.login}</> : "kapcsolódás…"}
          <button onClick={() => { if (window.confirm("Kijelentkezel és törlöd a tokent erről az eszközről?")) onLogout(); }} className="ml-1 rounded border border-border px-1.5 py-0.5">Kijelentkezés</button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-2xl min-h-0 flex-1 flex-col gap-2 p-3">
        <div className="flex gap-2">
          <select value={repo} onChange={(e) => setRepo(e.target.value)} className="field min-w-0 flex-[2] font-mono text-xs">
            <option value="">{repos.length ? "Repó…" : "Betöltés…"}</option>
            {repos.map((r) => <option key={r.full_name} value={r.full_name}>{r.private ? "🔒 " : ""}{r.full_name.split("/")[1]}</option>)}
          </select>
          {repoZip ? (
            <a href={repoZip} target="_blank" rel="noopener noreferrer" title={`Teljes repó letöltése (ZIP) · ${branch}`} aria-label="Teljes repó letöltése ZIP-ben" className="flex w-9 shrink-0 items-center justify-center rounded-md border border-border bg-card">
              <Download className="h-4 w-4" />
            </a>
          ) : (
            <button type="button" disabled title="Válassz repót" aria-label="Teljes repó letöltése ZIP-ben" className="flex w-9 shrink-0 items-center justify-center rounded-md border border-border bg-card opacity-40">
              <Download className="h-4 w-4" />
            </button>
          )}
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
        {release && release.id !== seenId && !active.length && !building && (
          <div className="shrink-0 space-y-1 rounded-md border border-border p-1.5 font-mono text-[11px]">
            <div className="flex items-center gap-1">
              <div className="flex-1 truncate text-muted-foreground">Utolsó APK elérhető: {release.name} · {stamp(release.published)}</div>
              <button onClick={() => { markSeen(repo, release.id); setSeenId(release.id); }} className="rounded border border-border px-1.5 py-0.5">elrejt</button>
            </div>
            {release.assets.map((a) => (
              <a key={a.name} href={a.url} target="_blank" rel="noopener noreferrer" onClick={() => { markSeen(repo, release.id); setTimeout(() => setSeenId(release.id), 400); }} className="flex items-center gap-1 rounded bg-secondary px-2 py-1.5 text-secondary-foreground">
                <span>⬇</span><span className="flex-1 truncate">{a.name}</span><span className="text-muted-foreground">{a.size >= 1048576 ? (a.size / 1048576).toFixed(1) + " MB" : Math.ceil(a.size / 1024) + " KB"}</span>
              </a>
            ))}
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card">
        {repo && (
          <div className="flex shrink-0 gap-1 border-b border-border p-1 font-mono text-[11px]">
            <button onClick={() => setLogTab("log")} className={`rounded border px-2 py-1 ${logTab === "log" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>Napló</button>
            {active.length > 0 && (
              <button onClick={() => setLogTab("action")} className={`flex-1 truncate rounded border px-2 py-1 text-left ${logTab === "action" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
                <span className="animate-pulse text-primary">●</span> Action folyamatban ({active.length})
              </button>
            )}
            <button onClick={refresh} title="Állapot frissítése" className="ml-auto rounded border border-border px-2 py-1">↻ Frissítés</button>
          </div>
        )}
        {stage === 3 && (
          <div className="max-h-[40vh] shrink-0 space-y-1 overflow-auto border-b border-border p-1.5 font-mono text-[11px]">
            <div className="flex gap-1">
              <button disabled={building} onClick={build} className="flex-1 rounded bg-primary px-2 py-1.5 font-bold text-primary-foreground disabled:opacity-50">
                {building ? "Build fut…" : runs.length ? "Új build" : "▶ Friss build indítása"}
              </button>
              <button onClick={saveLog} className="rounded border border-border px-2 py-1.5">{isNative() ? "⧉ Napló" : "⇩ Napló"}</button>
            </div>
            {runs.map((x) => (
              <div key={x.id} className="space-y-0.5">
                <div className="flex items-center gap-1">
                  <span className={dot(x.status, x.conclusion)}>●</span>
                  <a href={x.url} target="_blank" rel="noreferrer" className="flex-1 truncate underline">{x.name} <span className="text-muted-foreground">({x.event})</span></a>
                  <span className="text-muted-foreground">{x.conclusion ?? x.status}</span>
                  {x.status === "completed" && <a href={logZip(x)} target="_blank" rel="noreferrer" className={`rounded border px-1.5 ${x.conclusion === "failure" ? "border-destructive text-destructive" : "border-border"}`}>⇩ log ZIP</a>}
                  {x.status === "completed" && <button onClick={() => details(x)} className="rounded border border-border px-1.5">részletek</button>}
                </div>
                {x.jobs.map((j) => (
                  <div key={j.name} className="pl-3 text-muted-foreground">
                    <span className={dot(j.status, j.conclusion)}>●</span> {j.status === "completed" && j.conclusion === "failure" ? <a href={j.url} target="_blank" rel="noreferrer" className="underline">{j.name} (napló)</a> : j.name}
                    {j.status !== "completed" && j.steps.find((s: { status: string }) => s.status === "in_progress") && <> · {j.steps.find((s: { status: string }) => s.status === "in_progress")!.name}</>}
                    {j.steps.length > 0 && <> · {j.steps.filter((s: { status: string }) => s.status === "completed").length}/{j.steps.length}</>}
                  </div>
                ))}
              </div>
            ))}
            {building && !runs.length && <div className="animate-pulse text-muted-foreground">Várakozás a GitHubra…</div>}
          </div>
        )}
        {logTab === "action" && active.length > 0 ? (
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-2 font-mono text-[10px] text-muted-foreground">
            {actionText(active)}
          </pre>
        ) : (
        <pre ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-2 font-mono text-[10px] text-muted-foreground">
          {log.length ? log.join("\n") : "Napló…"}
        </pre>
        )}
        </div>
      </div>
    </main>
    </>
  );
}

// Dátum + idő (helyi idő), hogy a release-ek megkülönböztethetők legyenek.
function stamp(iso: string): string {
  return new Date(iso).toLocaleString("hu-HU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function stepIcon(s: string, c: string | null) {
  if (s !== "completed") return s === "in_progress" ? "▶" : "○";
  return c === "success" ? "✔" : c === "skipped" || c === "cancelled" ? "–" : "✖";
}

// Futó/lefutott action élő állapota: hol tart épp a build.
function actionText(runs: Run[]): string {
  return runs.map((r) => {
    const head = `${stepIcon(r.status, r.conclusion)} ${r.name} (${r.event}) · ${r.conclusion ?? r.status}`;
    const jobs = r.jobs.map((j) => {
      const done = j.steps.filter((x) => x.status === "completed").length;
      const cur = j.steps.find((x) => x.status === "in_progress");
      const where = j.status !== "completed" ? `\n    Most itt tart: ${cur ? cur.name : "várakozás a futtatóra"} (${done}/${j.steps.length})` : "";
      const steps = j.steps.map((x) => `      ${stepIcon(x.status, x.conclusion)} ${x.name}`).join("\n");
      return `  ${stepIcon(j.status, j.conclusion)} ${j.name}${where}\n${steps}`;
    }).join("\n");
    return `${head}\n${jobs}\n  ${r.url}`;
  }).join("\n\n");
}

function dot(s: string, c: string | null) {
  if (s !== "completed") return "text-primary animate-pulse";
  return c === "success" ? "text-primary" : c === "skipped" || c === "cancelled" ? "text-muted-foreground" : "text-destructive";
}

function safe<T>(f: () => T, d: T): T { try { return f(); } catch { return d; } }
