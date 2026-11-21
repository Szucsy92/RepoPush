import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, RefreshCw, X } from "lucide-react";
import { GitHub, planZip, type LatestRelease, type Plan, type Repo, type Run } from "@/lib/github";
import { readZip, toBase64, patchTargets, applyPatchText, type LocalFile } from "@/lib/repo-files";
import { loadToken, loadLegacyToken, clearToken } from "@/lib/token";
import { hasVault } from "@/lib/lock";
import { isNative } from "@/lib/native";
import { markSeen, seenRelease } from "@/lib/seen";
import { TokenScreen } from "@/TokenScreen";
import { PinSetup, LockScreen } from "@/PinScreens";
import { RepoPicker } from "@/RepoPicker";
import { DiffEditor } from "@/DiffEditor";
import { Brand } from "@/Brand";
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
  const [stopping, setStopping] = useState(false); // leállítás kérve, a futás még nem zárult le
  const [forceReady, setForceReady] = useState(false); // ha a leállítás nem hat, kényszeríthető
  const cancelWanted = useRef(false); // a build még nem jelent meg: amint megjelenik, leállítjuk
  const forceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [stage, setStage] = useState<0 | 1 | 2 | 3 | -1>(0);
  const [pct, setPct] = useState(0);
  const [step, setStep] = useState("");

  const [repos, setRepos] = useState<Repo[]>([]);
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
  const pokeRef = useRef<(() => Promise<void>) | null>(null);
  const actPhases = useRef<Record<string, string>>({});
  const patchFile = useRef<HTMLInputElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState("");
  const [activeAt, setActiveAt] = useState("");
  const [activeErr, setActiveErr] = useState("");
  const [drag, setDrag] = useState(false);
  const add = (s: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString()}  ${s}`]);

  // Build status strip: one line with the current step; tapping it drops down the full run list.
  // Any tap outside the strip/dropdown folds it back.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const out = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("pointerdown", out);
    return () => document.removeEventListener("pointerdown", out);
  }, [menuOpen]);
  const [ddOpen, setDdOpen] = useState(false);
  const [ddMax, setDdMax] = useState(240);
  const ddRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!ddOpen) return;
    // The list may grow down to the bottom of the log window and scrolls inside when there is more.
    const measure = () => {
      const c = cardRef.current, st = stripRef.current;
      if (c && st) setDdMax(Math.max(120, Math.floor(c.getBoundingClientRect().bottom - st.getBoundingClientRect().bottom - 6)));
    };
    measure();
    const out = (e: PointerEvent) => { if (!ddRef.current?.contains(e.target as Node)) setDdOpen(false); };
    document.addEventListener("pointerdown", out);
    window.addEventListener("resize", measure);
    return () => { document.removeEventListener("pointerdown", out); window.removeEventListener("resize", measure); };
  }, [ddOpen]);

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
  useEffect(() => {
    if (building) return;
    setStopping(false); setForceReady(false); cancelWanted.current = false;
    if (forceTimer.current) clearTimeout(forceTimer.current);
  }, [building]);
  useEffect(() => { setSeenId(repo ? seenRelease(repo) : undefined); }, [repo, release]);

  // Az építés-panelben már követett futások azonosítói: ezeket a figyelő nem jelzi külön.
  const panelIds = useRef<Set<number>>(new Set());
  useEffect(() => { panelIds.current = new Set(runs.map((x) => x.id)); }, [runs]);

  // Futó action figyelése: minden futás, ami nem az appból indított build-panelhez tartozik (automatikus,
  // push által indított, másik helyről indított), „Action folyamatban” fület kap élő lépésekkel, és a fázisai
  // a naplóba is bekerülnek. Menet közben induló futásokat is felvesz.
  useEffect(() => {
    setActive([]); setLogTab("log"); activeRef.current = []; actPhases.current = {};
    if (!repo) return;
    let alive = true;
    let first = true;
    const tracked = new Set<number>();
    const seenDone = new Set<number>(); // lezárult futások, amikről már tudunk
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inflight: Promise<void> | null = null;
    let errs = 0;
    const body = async () => {
      let delay = 15000;
      if (document.visibilityState === "visible") {
        try {
          const { open: now, closed } = await gh.runsOverview(repo);
          if (!alive) return;
          const first_ = first;
          const fresh = now.filter((x) => !tracked.has(x.id) && !panelIds.current.has(x.id));
          fresh.forEach((x) => tracked.add(x.id));
          if (fresh.length) add(`${first_ ? "Futó action" : "Új action indult"}: ${fresh.map((x) => x.name).join(", ")}`);
          first = false;
          const mine = now.filter((x) => tracked.has(x.id));
          const prev = activeRef.current;
          const gone = prev.filter((p) => !mine.some((m) => m.id === p.id));
          if (gone.length) {
            const done = await gh.getRuns(repo, gone.map((x) => x.id)).catch(() => []);
            if (!alive) return;
            logPhases(done, actPhases.current);
            add(`ACTION KÉSZ: ${done.map((x) => `${x.name} → ${x.conclusion ?? x.status}`).join(", ") || "lefutott"}`);
            gone.forEach((x) => { tracked.delete(x.id); seenDone.add(x.id); });
            if (!mine.length) setLogTab("log");
            setRelTick((n) => n + 1);
          }
          // Ami úgy futott le, hogy nem láttuk futni (gyors futás, két lekérdezés között): legalább az eredményét jelezzük.
          const unseen = closed.filter((x) => !seenDone.has(x.id));
          if (!first_) {
            const quick = unseen.filter((x) => !tracked.has(x.id) && !panelIds.current.has(x.id));
            if (quick.length) { add(`Action lefutott: ${quick.map((x) => `${x.name} → ${x.conclusion ?? x.status}`).join(", ")}`); setRelTick((n) => n + 1); }
          }
          unseen.forEach((x) => seenDone.add(x.id));
          logPhases(mine, actPhases.current);
          if (!prev.length && mine.length) setLogTab("action");
          activeRef.current = mine;
          setActive(mine);
          setActiveAt(new Date().toLocaleTimeString());
          errs = 0;
          setActiveErr("");
          if (mine.length) delay = 8000;
        } catch (e: any) {
          // Ne maradjon csendben elavult állapot: a hiba látszik az Action fülön, és ritkábban próbálkozunk.
          errs++;
          setActiveErr(e?.message ?? String(e));
          delay = errs > 2 ? 30000 : 15000;
        }
      }
      if (alive) timer = setTimeout(tick, delay);
    };
    const tick = (): Promise<void> => {
      if (!inflight) inflight = body().finally(() => { inflight = null; });
      return inflight;
    };
    const wake = (): Promise<void> => {
      if (document.visibilityState !== "visible") return Promise.resolve();
      if (timer) clearTimeout(timer);
      return tick();
    };
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

  const targets = useMemo(() => (tab === "patch" && patch.trim() ? safe(() => patchTargets(patch), []) : []), [patch, tab]);

  function clearZip() { setZipFiles([]); setZipName(""); }

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
    let fails = 0;
    let running = false;
    const tick = async () => {
      if (stop || running) return;
      running = true;
      try {
        const r = await gh.buildStatus(repo, branch, since);
        if (stop) return;
        fails = 0;
        setRuns(r);
        logPhases(r);
        if (cancelWanted.current) {
          const open = r.filter((x) => x.status !== "completed");
          if (open.length) { cancelWanted.current = false; void cancelOpen(open, false); }
        }
        const done = r.length > 0 && r.every((x) => x.status === "completed");
        if (done) { setBuilding(false); add(`BUILD KÉSZ: ${r.map((x) => `${x.name} → ${x.conclusion}`).join(", ")}`); setRelTick((n) => n + 1); return; }
        // Ne ragadjon be: ha 2 percig nem indult futás, vagy 45 percnél tovább tart, feladjuk a várakozást.
        if (!r.length && Date.now() - t0 > 120000) { setBuilding(false); add("Nem indult build ebben a 2 percben. Nézd meg az Actions oldalt, vagy indíts újat."); return; }
        if (Date.now() - t0 > 45 * 60000) { setBuilding(false); add("A build követése időtúllépés miatt leállt (45 perc). A ↻ gombbal újra lekérdezheted."); return; }
      } catch (e: any) {
        fails++;
        if (fails === 1 || fails % 10 === 0) add(`Build állapot hiba: ${e.message}`);
      } finally { running = false; }
      if (!stop) timer = setTimeout(tick, fails ? Math.min(4000 * 2 ** Math.min(fails, 3), 30000) : 4000);
    };
    // Visszalépéskor azonnal újra lekérdez (a háttérben az időzítők lassulnak).
    const wake = () => { if (document.visibilityState === "visible") { if (timer) clearTimeout(timer); tick(); } };
    document.addEventListener("visibilitychange", wake);
    tick();
    return () => { stop = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", wake); };
  }, [since, pollTick]);

  // Az új build fázisait folyamatosan a naplóba írja (csak a változásokat).
  function logPhases(rs: Run[], ph: Record<string, string> = phases.current) {
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

  // Kézi frissítés: release, futó action és (ha követünk buildet) a build állapota is. Látható visszajelzéssel.
  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setRelTick((n) => n + 1);
    setPollTick((n) => n + 1);
    try {
      await Promise.all([pokeRef.current?.(), new Promise((r) => setTimeout(r, 700))]);
    } finally {
      setRefreshedAt(new Date().toLocaleTimeString());
      setRefreshing(false);
    }
  }

  async function build() {
    setBuilding(true); setRuns([]); phases.current = {}; setLogTab("log");
    setStopping(false); setForceReady(false); cancelWanted.current = false;
    const t = new Date(Date.now() - 5000).toISOString().replace(/\.\d+Z$/, "Z");
    try {
      const r = await gh.startBuild(repo, branch);
      add(`BUILD START → ${r.started.length ? r.started.join(", ") : "nincs kézzel indítható workflow, a feltöltés által indítottakat követem"}`);
      if (r.skipped.length) add(`  (kihagyva, nincs workflow_dispatch: ${r.skipped.join(", ")})`);
      setSince(""); setTimeout(() => setSince(t), 3000);
    } catch (e: any) { add(`Build hiba: ${e.message}`); setBuilding(false); }
  }

  async function cancelOpen(rs: Run[], force: boolean) {
    const stopped = await Promise.all(rs.map(async (x) => {
      try { await gh.cancelRun(repo, x.id, force); return x.name; }
      catch (e: any) {
        if (e?.status === 409) return null; // közben lezárult
        add(`Leállítás hiba (${x.name}): ${e.message}`);
        return null;
      }
    }));
    const ok = stopped.filter(Boolean);
    if (ok.length) add(`${force ? "KÉNYSZERÍTETT LEÁLLÍTÁS" : "LEÁLLÍTÁS"} kérve: ${ok.join(", ")}`);
  }

  // Ugyanaz a gomb: Build → futás közben Mégse / Leállítás → ha nem hat, Kényszerítés.
  async function stopBuild() {
    const force = stopping && forceReady;
    if (stopping && !forceReady) return;
    const open = runs.filter((x) => x.status !== "completed");
    if (!open.length) {
      // Még nem jelent meg a futás a GitHubon: amint megjelenik, leállítjuk.
      cancelWanted.current = true;
      setStopping(true);
      add("MÉGSE: a build leáll, amint megjelenik a GitHubon.");
      return;
    }
    const names = open.map((x) => x.name).join(", ");
    const q = force ? `A leállítás nem hatott. Kényszeríted a leállítást? (${names})` : `Leállítod a futó buildet? (${names})`;
    if (!window.confirm(q)) return;
    setStopping(true); setForceReady(false);
    if (forceTimer.current) clearTimeout(forceTimer.current);
    forceTimer.current = setTimeout(() => setForceReady(true), 15000);
    await cancelOpen(open, force);
    setPollTick((n) => n + 1); // az új állapot azonnal látszik
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

  const sum = buildSummary(runs, building);
  const openRuns = runs.filter((x) => x.status !== "completed");

  return (
    <>
    {confirm && <ConfirmDialog plan={confirm.plan} repo={repo} branch={branch} mode={tab === "patch" ? "patch" : mode === "replace" ? "teljes csere" : "beillesztés"}
      onOk={() => { confirm.resolve(true); setConfirm(null); }} onCancel={() => { confirm.resolve(false); setConfirm(null); }} />}
    <main className="app-insets flex h-[100dvh] flex-col overflow-hidden text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-y-1.5 px-3 py-[5px]">
        <Brand className="hdr-brand" />
        <div ref={menuRef} className="hdr-profile relative">
          <button type="button" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen} className="flex h-8 items-center gap-1.5 rounded-full bg-card py-1 pl-1 pr-2.5 font-mono text-xs text-muted-foreground">
            {me ? <><img src={me.avatar} alt="" className="h-6 w-6 rounded-full" /><span className="text-foreground">{me.login}</span></> : <span className="pl-1.5">Bejelentkezés…</span>}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${menuOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 top-full z-30 mt-1.5 w-56 rounded-2xl border border-border bg-popover p-1.5 shadow-2xl">
              {me && <div className="truncate px-3 py-1.5 font-mono text-[11px] text-muted-foreground">Bejelentkezve: {me.login}</div>}
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); if (window.confirm("Kijelentkezel és törlöd a tokent erről az eszközről?")) onLogout(); }} className="w-full rounded-xl px-3 py-2.5 text-left font-mono text-sm text-destructive">Kijelentkezés</button>
            </div>
          )}
        </div>
        <div className="hdr-row flex gap-2">
          <RepoPicker repos={repos} value={repo} onChange={setRepo} />
          {repoZip ? (
            <a href={repoZip} target="_blank" rel="noopener noreferrer" title={`Teljes repó letöltése (ZIP) · ${branch}`} aria-label="Teljes repó letöltése ZIP-ben" className="flex w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card">
              <Download className="h-4 w-4" />
            </a>
          ) : (
            <button type="button" disabled title="Válassz repót" aria-label="Teljes repó letöltése ZIP-ben" className="flex w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card opacity-40">
              <Download className="h-4 w-4" />
            </button>
          )}
          <input list="branches" value={branch} onChange={(e) => setBranch(e.target.value)} className="field min-w-0 flex-1 font-mono text-xs" placeholder="ág" />
          <datalist id="branches">{branches.map((b) => <option key={b} value={b} />)}</datalist>
        </div>
      </header>

      <div className="land-grid mx-auto flex w-full max-w-2xl min-h-0 flex-1 flex-col gap-2 px-3 pb-3 pt-1">
        <div className="land-col">
        <div className="seg flex gap-1 rounded-xl border border-border bg-card p-1 font-mono text-xs">
          {(["zip", "patch"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-xl px-2 py-2 font-semibold ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
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
              className={`win relative flex min-h-[6.5rem] flex-[2] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-3 text-center ${drag ? "border-primary bg-accent" : "border-border bg-card"}`}
            >
              <input type="file" accept=".zip,.patch,.diff" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; onZip(f); }} />
              <div className="truncate font-mono text-sm">{zipName || "ZIP behúzása / tallózás"}</div>
              <div className="text-xs text-muted-foreground">{zipFiles.length ? `${zipFiles.length} fájl` : "letöltött repó szerkezet"}</div>
              {zipName && (
                <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); clearZip(); }} title="Törlés" aria-label="Törlés" className="absolute bottom-2.5 right-2.5 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
                  <X className="h-5 w-5" />
                </button>
              )}
            </label>
            <div className="seg flex gap-1 rounded-xl border border-border bg-card p-1 font-mono text-xs">
              <button onClick={() => setMode("replace")} title="Ami nincs a ZIP-ben, törlődik" className={`flex-1 rounded-xl px-2 py-2 font-semibold ${mode === "replace" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Teljes csere</button>
              <button onClick={() => setMode("merge")} title="A többi fájl marad" className={`flex-1 rounded-xl px-2 py-2 font-semibold ${mode === "merge" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Beillesztés</button>
            </div>
          </>
        ) : (
          <>
            {/* Same window as the ZIP one (size, dashed frame); a round frosted button clears it. */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={async (e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) setPatch(await f.text()); }}
              className={`win relative flex min-h-[6.5rem] flex-[2] overflow-hidden rounded-xl border-2 border-dashed ${drag ? "border-primary bg-accent" : "border-border bg-card"}`}
            >
              <DiffEditor value={patch} onChange={setPatch} padBottom={!!patch} />
              {!patch && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-3 text-center">
                  <button type="button" onClick={() => patchFile.current?.click()} className="pointer-events-auto max-w-full truncate font-mono text-sm">Diff behúzása / tallózás</button>
                  <div className="text-xs text-muted-foreground">vagy érints ide, és illeszd be</div>
                </div>
              )}
              {patch && (
                <button type="button" onClick={() => setPatch("")} title="Törlés" aria-label="Törlés" className="absolute bottom-2.5 right-2.5 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
                  <X className="h-5 w-5" />
                </button>
              )}
              <input ref={patchFile} type="file" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setPatch(await f.text()); }} />
            </div>
            {targets.length > 0 && (
              <div className="truncate font-mono text-xs text-muted-foreground">
                {targets.length} fájl: {targets.map((t) => t.newPath ?? t.oldPath).join(", ")}
              </div>
            )}
          </>
        )}

        <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Commit üzenet (opcionális)" className="field text-xs" />
        <button disabled={busy || !repo} onClick={run} data-haptic="medium" className="act truncate rounded-xl bg-primary px-3 py-2.5 font-mono text-sm font-bold text-primary-foreground disabled:opacity-40">
          {busy ? "Folyamatban…" : repo ? `Végrehajtás → ${branch}` : "Válassz repót"}
        </button>
        </div>
        <div className="land-col">
        {release && release.id !== seenId && !active.length && !building && (
          <div className="shrink-0 space-y-1 rounded-xl border border-border bg-card p-1.5 font-mono text-[11px]">
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
        <div ref={cardRef} className="flex min-h-[9rem] flex-[5] flex-col overflow-hidden rounded-xl border border-border bg-card">
        {repo && (
          <div className="flex shrink-0 gap-1 border-b border-border p-1 font-mono text-[11px]">
            <button onClick={() => setLogTab("log")} className={`rounded border px-2 py-1 ${logTab === "log" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>Napló</button>
            {active.length > 0 && (
              <button onClick={() => setLogTab("action")} className={`min-w-0 flex-1 truncate rounded border px-2 py-1 text-left ${logTab === "action" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
                <span className="animate-pulse text-primary">●</span> Action folyamatban ({active.length})
              </button>
            )}
            <button onClick={refresh} disabled={refreshing} title={refreshedAt ? `Állapot frissítése · utoljára: ${refreshedAt}` : "Állapot frissítése"} className="ml-auto flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 disabled:opacity-70">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-primary" : ""}`} />
              {refreshing ? "Frissítés…" : refreshedAt || "Frissítés"}
            </button>
          </div>
        )}
        {/* Progress is part of the log window: the stage and step as one line, with a thin bar from Start to Finish. */}
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="relative flex shrink-0 items-center gap-1.5 px-3 pb-1.5 pt-1 font-mono text-[11px]">
          <span className={`shrink-0 font-bold ${stage === -1 ? "text-destructive" : stage === 1 || stage === 2 ? "animate-pulse" : ""}`}>{stage === -1 ? "Hiba" : stage === 1 ? "Start" : stage === 2 ? "Process" : stage === 3 ? "Finish" : "Várakozás"}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{stage === 0 ? "" : step}</span>
          {stage !== 0 && <span className="shrink-0">{pct}%</span>}
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-border/40"><div className={`h-full transition-all ${stage === -1 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} /></div>
        </div>
        {stage === 3 && (
          <div ref={stripRef} className="relative flex shrink-0 gap-1 border-b border-border p-1 font-mono text-[11px]">
            <div ref={ddRef} className="min-w-0 flex-1">
              <button onClick={() => setDdOpen((o) => !o)} aria-expanded={ddOpen} className="flex w-full items-center gap-1 rounded border border-border px-2 py-1.5 text-left">
                <span className={sum.dot}>●</span>
                <span className="min-w-0 flex-1 truncate">{sum.text}</span>
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${ddOpen ? "rotate-180" : ""}`} />
              </button>
              {ddOpen && (
                <div style={{ maxHeight: ddMax }} className="absolute left-1 right-1 top-full z-10 mt-0.5 space-y-1 overflow-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl">
                  {runs.map((x) => (
                    <div key={x.id} className="space-y-0.5">
                      <div className="flex items-center gap-1">
                        <span className={dot(x.status, x.conclusion)}>●</span>
                        <a href={x.url} target="_blank" rel="noreferrer" className="flex-1 truncate underline">{x.name} <span className="text-muted-foreground">({x.event})</span></a>
                        <span className="text-muted-foreground">{x.conclusion ?? x.status}</span>
                        {x.status === "completed" && <a href={logZip(x)} target="_blank" rel="noreferrer" className={`rounded border px-1.5 ${x.conclusion === "failure" ? "border-destructive text-destructive" : "border-border"}`}>⇩ log ZIP</a>}
                        {x.status === "completed" && <button onClick={() => { details(x); setDdOpen(false); }} className="rounded border border-border px-1.5">részletek</button>}
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
                  {!runs.length && <div className={`text-muted-foreground ${building ? "animate-pulse" : ""}`}>{building ? "Várakozás a GitHubra…" : "Még nincs követett build."}</div>}
                </div>
              )}
            </div>
            <button
              disabled={building && stopping && !forceReady}
              onClick={building ? stopBuild : build}
              data-haptic="medium"
              title={building ? (stopping && forceReady ? "Kényszerített leállítás (force-cancel)" : "A futó build leállítása") : "Friss build indítása"}
              className={`shrink-0 rounded px-2 py-1.5 font-bold disabled:opacity-60 ${building ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}
            >
              {!building ? (runs.length ? "Új build" : "▶ Build") : !stopping ? (openRuns.length ? "■ Leállítás" : "Mégse") : forceReady ? "Kényszerítés" : "Leállítás…"}
            </button>
            <button onClick={saveLog} title={isNative() ? "Napló másolása" : "Napló mentése"} aria-label={isNative() ? "Napló másolása" : "Napló mentése"} className="shrink-0 rounded border border-border px-2 py-1.5">{isNative() ? "⧉" : "⇩"}</button>
          </div>
        )}
        {logTab === "action" && active.length > 0 ? (
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-2 font-mono text-[10px] text-muted-foreground">
            {`Frissítve: ${activeAt} · 8 mp-enként magától is\n${activeErr ? `⚠ A frissítés most nem sikerül (${activeErr}), az állapot elavult lehet.\n` : ""}\n`}{actionText(active)}
          </pre>
        ) : (
        <pre ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-2 font-mono text-[10px] text-muted-foreground">
          {log.length ? log.join("\n") : "Napló…"}
        </pre>
        )}
        </div>
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
const STATUS_HU: Record<string, string> = {
  queued: "sorban áll", in_progress: "fut", requested: "indul",
  waiting: "vár (jóváhagyásra vagy az előző futásra)", pending: "másik futás után indul (concurrency)",
};
function actionText(runs: Run[]): string {
  return runs.map((r) => {
    const mins = r.created ? Math.max(0, Math.round((Date.now() - Date.parse(r.created)) / 60000)) : null;
    const since = r.created ? ` · ${new Date(r.created).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })}-kor indult (${mins} perce)` : "";
    const head = `${stepIcon(r.status, r.conclusion)} ${r.name} (${r.event}) · ${r.conclusion ?? STATUS_HU[r.status] ?? r.status}${since}`;
    const jobs = r.jobs.length ? r.jobs.map((j) => {
      const done = j.steps.filter((x) => x.status === "completed").length;
      const cur = j.steps.find((x) => x.status === "in_progress");
      const where = j.status !== "completed" ? `\n    Most itt tart: ${cur ? cur.name : "várakozás a futtatóra"} (${done}/${j.steps.length})` : "";
      const steps = j.steps.map((x) => `      ${stepIcon(x.status, x.conclusion)} ${x.name}`).join("\n");
      return `  ${stepIcon(j.status, j.conclusion)} ${j.name}${where}\n${steps}`;
    }).join("\n") : "  (még nincs job: a GitHub most állítja össze, sorban áll a futtatóra, vagy másik futás után indul; ha régóta így van, nyisd meg a futás oldalát)";
    return `${head}\n${jobs}\n  ${r.url}`;
  }).join("\n\n");
}

// The one-line state of the tracked build: what runs right now, otherwise how it ended.
function buildSummary(runs: Run[], building: boolean): { dot: string; text: string } {
  if (!runs.length) return building ? { dot: "text-primary animate-pulse", text: "Várakozás a GitHubra…" } : { dot: "text-muted-foreground", text: "Nincs követett build" };
  const running = runs.filter((r) => r.status !== "completed");
  if (running.length) {
    const r = running[0]!;
    const j = r.jobs.find((x) => x.status !== "completed") ?? r.jobs[0];
    const step = j?.steps.find((x) => x.status === "in_progress");
    const done = j ? j.steps.filter((x) => x.status === "completed").length : 0;
    const where = [r.name, j && j.name !== r.name ? j.name : "", step?.name ?? (j ? "várakozás" : "")].filter(Boolean).join(" · ");
    return { dot: "text-primary animate-pulse", text: `${where}${j?.steps.length ? ` (${done}/${j.steps.length})` : ""}${running.length > 1 ? ` +${running.length - 1}` : ""}` };
  }
  const bad = runs.filter((r) => r.conclusion && !["success", "skipped", "cancelled"].includes(r.conclusion));
  if (bad.length) return { dot: "text-destructive", text: `✖ ${bad[0]!.name}: ${bad[0]!.conclusion}${bad.length > 1 ? ` +${bad.length - 1}` : ""}` };
  return { dot: "text-ok", text: `✔ Kész · ${runs.length} futás` };
}

function dot(s: string, c: string | null) {
  if (s !== "completed") return "text-primary animate-pulse";
  return c === "success" ? "text-ok" : c === "skipped" || c === "cancelled" ? "text-muted-foreground" : "text-destructive";
}

function safe<T>(f: () => T, d: T): T { try { return f(); } catch { return d; } }
