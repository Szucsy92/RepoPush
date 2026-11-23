import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, Download, Maximize2, Minimize2, RefreshCw, X } from "lucide-react";
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
import { openRect, readInsets, type Rect } from "@/lib/expand";
import { Brand } from "@/Brand";
import { StatusIcon, kindOf, type Kind } from "@/StatusIcon";
import { pollDelay, errorDelay } from "@/lib/cadence";
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
  const activeRef = useRef<Run[]>([]);
  const buildingRef = useRef(false);
  const pokeRef = useRef<(() => Promise<void>) | null>(null);
  const actPhases = useRef<Record<string, string>>({});
  const patchFile = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [expanded, setExpanded] = useState(false); // a diff ablak kinyitva: a képernyő tetejétől a feléig ér
  const [panel, setPanel] = useState<CSSProperties | null>(null); // a diff ablak rögzített téglalapja, amíg nyitva van vagy mozog
  const [big, setBig] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const openW = useRef(0); // képernyőszélesség nyitáskor: csak forgatáskor számolunk újra
  const openGoal = useRef<Rect | null>(null); // a nyitott ablak célméretete
  useEffect(() => { if (tab !== "patch") { setExpanded(false); setPanel(null); setBig(false); closing.current = false; } }, [tab]);
  useEffect(() => {
    if (!panel || !expanded) return;
    // Forgatás: új célméret. Billentyűzet (csak a magasság változik): az ablak marad ott és akkora, ahol és amekkora volt,
    // legfeljebb a látható területre szorul, ha a billentyűzet nagyon sokat takar, és visszanő, amikor eltűnik.
    const onResize = () => {
      const slot = slotRef.current; if (!slot) return;
      if (window.innerWidth !== openW.current) {
        openW.current = window.innerWidth;
        const goal = openTarget(slot.getBoundingClientRect());
        openGoal.current = goal;
        setPanel({ position: "fixed", ...rectCss(goal), transition: "none" });
        return;
      }
      const goal = openGoal.current; if (!goal) return;
      const height = Math.max(120, Math.min(goal.height, window.innerHeight - 4 - goal.top));
      setPanel((p) => (p && Number(p.height) !== height ? { ...p, height, transition: "none" } : p));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [expanded, !!panel]);
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
  // Minden futás egyben: amit a build sáv követ (Build gomb, feltöltés utáni futások) és amit a figyelő talált (push, más gép).
  const allRuns = [...runs, ...active.filter((a) => !runs.some((r) => r.id === a.id))];
  const openAll = allRuns.filter((x) => x.status !== "completed");
  const running = building || openAll.length > 0;
  useEffect(() => {
    if (running) return;
    setStopping(false); setForceReady(false); cancelWanted.current = false;
    if (forceTimer.current) clearTimeout(forceTimer.current);
  }, [running]);

  // Leállítás kérve egy-egy futásra (az Action fülről vagy a build sáv listájából): futásonként követjük, mikor kérték.
  const [stopReq, setStopReq] = useState<Record<number, number>>({});
  const [, setStopTick] = useState(0);
  useEffect(() => {
    // Ami már nem fut, annak a jelzése is megszűnik.
    const open = new Set([...active.map((x) => x.id), ...runs.filter((x) => x.status !== "completed").map((x) => x.id)]);
    setStopReq((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([id]) => open.has(+id)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [active, runs]);
  const anyStopReq = Object.keys(stopReq).length > 0;
  useEffect(() => {
    if (!anyStopReq) return;
    const id = setInterval(() => setStopTick((n) => n + 1), 3000); // 15 mp után megjelenik a Kényszerítés
    return () => clearInterval(id);
  }, [anyStopReq]);
  useEffect(() => { setSeenId(repo ? seenRelease(repo) : undefined); }, [repo, release]);

  // Az építés-panelben már követett futások azonosítói: ezeket a figyelő nem jelzi külön.
  const panelIds = useRef<Set<number>>(new Set());
  useEffect(() => { panelIds.current = new Set(runs.map((x) => x.id)); }, [runs]);

  // Futó action figyelése: minden futás, ami nem az appból indított build-panelhez tartozik (automatikus,
  // push által indított, másik helyről indított), „Action folyamatban” fület kap élő lépésekkel, és a fázisai
  // a naplóba is bekerülnek. Menet közben induló futásokat is felvesz.
  useEffect(() => {
    setActive([]); activeRef.current = []; actPhases.current = {};
    if (!repo) return;
    let alive = true;
    let first = true;
    const tracked = new Set<number>();
    const seenDone = new Set<number>(); // lezárult futások, amikről már tudunk
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inflight: Promise<void> | null = null;
    let errs = 0;
    let ticks = 0;
    const t0 = Date.now(); // a repó megnyitása: az első 5 mp-ben másodpercenként nézünk rá
    const body = async () => {
      let delay = 8000;
      if (document.visibilityState === "visible") {
        try {
          const { open: now, closed } = await gh.runsOverview(repo, ticks++ % 6 === 0); // a teljes (szűrt listás) keresés csak minden 6. körben
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
          activeRef.current = mine;
          setActive(mine);
          errs = 0;
          // Minél gyorsabban látszódjon az állapot: indulás után 1 mp, futás közben 5 mp, egyébként 8 mp.
          delay = pollDelay({ sinceOpenMs: Date.now() - t0, anyOpen: now.length > 0 || buildingRef.current });
        } catch {
          errs++;
          delay = errorDelay(errs);
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
      if (!stop) timer = setTimeout(tick, fails ? Math.min(2000 * 2 ** Math.min(fails, 4), 30000) : pollDelay({ sinceOpenMs: Date.now() - t0, anyOpen: true }));
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

  // Kézi frissítés: azonnal lekérdez mindent (release, futó actionök, build állapota). Külön kijelzése nincs.
  function refresh() {
    setRelTick((n) => n + 1);
    setPollTick((n) => n + 1);
    void pokeRef.current?.();
  }

  async function build() {
    setBuilding(true); setRuns([]); phases.current = {};
    setStopping(false); setForceReady(false); cancelWanted.current = false;
    const t = new Date(Date.now() - 5000).toISOString().replace(/\.\d+Z$/, "Z");
    try {
      const r = await gh.startBuild(repo, branch);
      add(`BUILD START → ${r.started.length ? r.started.join(", ") : "nincs kézzel indítható workflow, a feltöltés által indítottakat követem"}`);
      if (r.skipped.length) add(`  (kihagyva, nincs workflow_dispatch: ${r.skipped.join(", ")})`);
      setSince(""); setTimeout(() => setSince(t), 3000);
    } catch (e: any) { add(`Build hiba: ${e.message}`); setBuilding(false); }
  }

  // A diff ablak harmonika-szerűen nyílik: a helyéről egyszerre felfelé és lefelé növekszik a célméretig, becsukáskor ugyanígy, visszafelé.
  const MOVE = "top .26s ease, left .26s ease, width .26s ease, height .26s ease, background-color .26s ease";
  const moveCss = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "none" : MOVE);
  const rectCss = (r: Rect): CSSProperties => ({ top: r.top, left: r.left, width: r.width, height: r.height });
  function openTarget(from: Rect): Rect {
    return openRect({ width: window.innerWidth, height: window.innerHeight }, readInsets(), matchMedia("(orientation: landscape) and (max-height: 34rem)").matches, from);
  }
  function openPatch() {
    const slot = slotRef.current; if (!slot) return;
    closing.current = false;
    const from = slot.getBoundingClientRect();
    const goal = openTarget(from);
    openW.current = window.innerWidth;
    openGoal.current = goal;
    setExpanded(true); setBig(false);
    setPanel({ position: "fixed", ...rectCss(from), transition: "none" }); // ugyanott, ahol volt: a hely a elrendezésben marad
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setBig(true);
      setPanel({ position: "fixed", ...rectCss(goal), transition: moveCss() });
    }));
  }
  function closePatch() {
    const slot = slotRef.current; if (!slot) return;
    closing.current = true;
    setExpanded(false); setBig(false);
    setPanel({ position: "fixed", ...rectCss(slot.getBoundingClientRect()), transition: moveCss() });
    setTimeout(() => { if (closing.current) { closing.current = false; setPanel(null); } }, 320); // a mozgás végén vissza a helyére
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

  // Ugyanaz a gomb: Build → futás közben Leállítás (minden futó action, bárhol indult) → ha nem hat, Kényszerítés.
  async function stopBuild() {
    const force = stopping && forceReady;
    if (stopping && !forceReady) return;
    const open = openAll;
    if (!open.length) {
      // Még nem jelent meg a futás a GitHubon: amint megjelenik, leállítjuk.
      cancelWanted.current = true;
      setStopping(true);
      add("MÉGSE: a build leáll, amint megjelenik a GitHubon.");
      return;
    }
    const names = open.map((x) => `${x.name} (${x.event})`).join(", ");
    const q = force ? `A leállítás nem hatott. Kényszeríted a leállítást? (${names})` : `Leállítod az összes futó actiont? (${names})`;
    if (!window.confirm(q)) return;
    setStopping(true); setForceReady(false);
    if (forceTimer.current) clearTimeout(forceTimer.current);
    forceTimer.current = setTimeout(() => setForceReady(true), 15000);
    await cancelOpen(open, force);
    setPollTick((n) => n + 1); // az új állapot azonnal látszik
    void pokeRef.current?.();
  }

  // Bármelyik futó action leállítható, akkor is, ha nem a Build gombbal indult (push, másik gép, GitHub-oldal).
  async function stopActive(r: Run, force = false) {
    const q = force ? `A leállítás nem hatott. Kényszeríted a leállítást? (${r.name})` : `Leállítod a futó action-t? (${r.name}, ${r.event})`;
    if (!window.confirm(q)) return;
    setStopReq((p) => ({ ...p, [r.id]: Date.now() }));
    await cancelOpen([r], force);
    void pokeRef.current?.(); // az új állapot azonnal látszik
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
        const { ops, errors, skipped } = applyPatchText(patch, src);
        skipped.forEach((f) => add(`  = ${f}: már alkalmazva, kihagyva`));
        errors.forEach((e) => add(e));
        if (errors.length) throw new Error("A patch nem minden része illeszthető, semmi sem lett feltöltve.");
        if (!ops.length) {
          add("Ez a diff már alkalmazva van a repón (nincs mit feltölteni), nem készült commit.");
          setStage(3); setPct(100); setStep("Már alkalmazva");
          return;
        }
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

  const sum = stateSummary({ stage, step, pct, runs: allRuns, building, hasRepo: !!repo });

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
        <div className="seg seg-tabs flex gap-1 rounded-xl border border-border bg-card p-1 font-mono text-xs">
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
            <div className="seg seg-mode flex gap-1 rounded-xl border border-border bg-card p-1 font-mono text-xs">
              <button onClick={() => setMode("replace")} title="Ami nincs a ZIP-ben, törlődik" className={`flex-1 rounded-xl px-2 py-2 font-semibold ${mode === "replace" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Teljes csere</button>
              <button onClick={() => setMode("merge")} title="A többi fájl marad" className={`flex-1 rounded-xl px-2 py-2 font-semibold ${mode === "merge" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Beillesztés</button>
            </div>
          </>
        ) : (
          <>
            {/* Same window as the ZIP one (size, dashed frame). The slot keeps its place in the layout; the window itself fills it,
                or, expanded like an accordion, opens from the top of the screen down to its middle. Two round frosted buttons: expand and clear. */}
            <div ref={slotRef} className="win relative min-h-[6.5rem] flex-[2]">
              <div
                style={panel ?? undefined}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={async (e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) setPatch(await f.text()); }}
                className={`${panel ? `fixed z-40 shadow-2xl ${big ? "bg-popover" : "bg-card"}` : "absolute inset-0 bg-card"} flex overflow-hidden rounded-xl border-2 border-dashed ${drag ? "border-primary bg-accent" : "border-border"}`}
              >
                <DiffEditor value={patch} onChange={setPatch} />
                {!patch && (
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-3 text-center">
                    <button type="button" onClick={() => patchFile.current?.click()} className="pointer-events-auto max-w-full truncate font-mono text-sm">Diff behúzása / tallózás</button>
                    <div className="text-xs text-muted-foreground">vagy érints ide, és illeszd be</div>
                  </div>
                )}
                <div className="absolute bottom-2.5 right-2.5 flex gap-2">
                  <button type="button" onClick={() => (expanded ? closePatch() : openPatch())} title={expanded ? "Összecsukás" : "Kinyitás"} aria-label={expanded ? "Összecsukás" : "Kinyitás"} aria-expanded={expanded} className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
                    {expanded ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
                  </button>
                  {patch && (
                    <button type="button" onClick={() => setPatch("")} title="Törlés" aria-label="Törlés" className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
                      <X className="h-5 w-5" />
                    </button>
                  )}
                </div>
                <input ref={patchFile} type="file" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setPatch(await f.text()); }} />
              </div>
            </div>
            {targets.length > 0 && (
              <div className="land-targets truncate font-mono text-xs text-muted-foreground">
                {targets.length} fájl: {targets.map((t) => t.newPath ?? t.oldPath).join(", ")}
              </div>
            )}
          </>
        )}

        <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Commit üzenet (opcionális)" className="field land-commit text-xs" />
        <button disabled={busy || !repo} onClick={run} data-haptic="medium" className="act truncate rounded-xl bg-primary px-3 py-2.5 font-mono text-sm font-bold text-primary-foreground disabled:opacity-40">
          {busy ? "Folyamatban…" : repo ? `Végrehajtás → ${branch}` : "Válassz repót"}
        </button>
        </div>
        <div className="land-col">
        {release && release.id !== seenId && !active.length && !building && (
          <div className="shrink-0 space-y-1 rounded-xl border border-border bg-card p-1.5 font-mono text-[11px]">
            <div className="flex items-center gap-1">
              <div className="flex-1 truncate text-muted-foreground">Utolsó APK elérhető: {release.name} · {stamp(release.published)}</div>
              <button onClick={() => { markSeen(repo, release.id); setSeenId(release.id); }} className="rounded-full border border-border px-2.5 py-1">elrejt</button>
            </div>
            {release.assets.map((a) => (
              <a key={a.name} href={a.url} target="_blank" rel="noopener noreferrer" onClick={() => { markSeen(repo, release.id); setTimeout(() => setSeenId(release.id), 400); }} className="flex items-center gap-1 rounded-xl bg-secondary px-3 py-1.5 text-secondary-foreground">
                <span>⬇</span><span className="flex-1 truncate">{a.name}</span><span className="text-muted-foreground">{a.size >= 1048576 ? (a.size / 1048576).toFixed(1) + " MB" : Math.ceil(a.size / 1024) + " KB"}</span>
              </a>
            ))}
          </div>
        )}
        <div ref={cardRef} className="flex min-h-[9rem] flex-[5] flex-col overflow-hidden rounded-xl border border-border bg-card">
        {/* One state strip for the whole area: the upload, or what the actions are doing (started here or elsewhere).
            Tap it for the details. The button is Build, or Stop (everything) while something runs. */}
        <div ref={stripRef} className="relative flex shrink-0 gap-1.5 border-b border-border p-1.5 font-mono text-[11px]">
          <div ref={ddRef} className="min-w-0 flex-1">
            <button onClick={() => setDdOpen((o) => !o)} aria-expanded={ddOpen} className="flex w-full items-center gap-2 rounded-xl border border-border px-3 py-1.5 text-left">
              <StatusIcon kind={sum.kind} />
              <span className="min-w-0 flex-1 truncate">{sum.text}</span>
              <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${ddOpen ? "rotate-180" : ""}`} />
            </button>
            {ddOpen && (
              <div style={{ maxHeight: ddMax }} className="absolute left-1.5 right-1.5 top-full z-10 mt-1 space-y-1.5 overflow-auto rounded-2xl border border-border bg-popover p-2 shadow-xl">
                <div className="flex justify-end">
                  <button onClick={saveLog} title={isNative() ? "Napló másolása" : "Napló mentése"} className="rounded-full border border-border px-3 py-1 text-[10px]">{isNative() ? "⧉ napló" : "⇩ napló"}</button>
                </div>
                {allRuns.map((x) => (
                  <div key={x.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <StatusIcon kind={kindOf(x.status, x.conclusion)} />
                      <a href={x.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate underline">{x.name} <span className="text-muted-foreground">({x.event})</span></a>
                      <span className="shrink-0 text-muted-foreground">{x.conclusion ?? x.status}</span>
                      {x.status === "completed" && <a href={logZip(x)} target="_blank" rel="noreferrer" className={`shrink-0 rounded-full border px-2.5 py-0.5 ${x.conclusion === "failure" ? "border-destructive text-destructive" : "border-border"}`}>⇩ log ZIP</a>}
                      {x.status === "completed" && <button onClick={() => { details(x); setDdOpen(false); }} className="shrink-0 rounded-full border border-border px-2.5 py-0.5">részletek</button>}
                      {x.status !== "completed" && <button onClick={() => stopActive(x, !!stopReq[x.id] && Date.now() - stopReq[x.id]! > 15000)} disabled={!!stopReq[x.id] && Date.now() - stopReq[x.id]! <= 15000} className="shrink-0 rounded-full border border-destructive/60 px-2.5 py-0.5 text-destructive disabled:opacity-60">{stopReq[x.id] ? (Date.now() - stopReq[x.id]! > 15000 ? "kényszerít" : "leáll…") : "■ leállít"}</button>}
                    </div>
                    {x.jobs.map((j) => (
                      <div key={j.name} className="space-y-0.5 pl-6 text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <StatusIcon kind={kindOf(j.status, j.conclusion)} className="h-4 w-4" />
                          <span className="min-w-0 flex-1 truncate">{j.status === "completed" && j.conclusion === "failure" ? <a href={j.url} target="_blank" rel="noreferrer" className="underline">{j.name} (napló)</a> : j.name}</span>
                          {j.steps.length > 0 && <span className="shrink-0">{j.steps.filter((st) => st.status === "completed").length}/{j.steps.length}</span>}
                        </div>
                        {j.status !== "completed" && j.steps.map((st, i) => (
                          <div key={i} className="flex items-center gap-2 pl-6">
                            <StatusIcon kind={kindOf(st.status, st.conclusion)} className="h-3.5 w-3.5" />
                            <span className={`min-w-0 flex-1 truncate ${st.status === "in_progress" ? "text-foreground" : ""}`}>{st.name}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
                {!allRuns.length && <div className={`text-muted-foreground ${building ? "animate-pulse" : ""}`}>{building ? "Várakozás a GitHubra…" : "Nincs követett futás."}</div>}
              </div>
            )}
          </div>
          <button onClick={refresh} title="Állapot frissítése" aria-label="Állapot frissítése" className="flex shrink-0 items-center justify-center rounded-xl border border-border px-2.5 py-1.5">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            disabled={(!running && !repo) || (running && stopping && !forceReady)}
            onClick={running ? stopBuild : build}
            data-haptic="medium"
            title={running ? (stopping && forceReady ? "Kényszerített leállítás (force-cancel)" : "Az összes futó action leállítása") : "Friss build indítása"}
            className={`shrink-0 rounded-xl px-3 py-1.5 font-bold disabled:opacity-60 ${running ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}
          >
            {!running ? (runs.length ? "Új build" : "▶ Build") : !stopping ? (openAll.length ? "■ Leállítás" : "Mégse") : forceReady ? "Kényszerítés" : "Leállítás…"}
          </button>
          {sum.progress && (
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="absolute inset-x-1.5 bottom-0 h-0.5 overflow-hidden rounded-full bg-border/40">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
        <pre ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-2 font-mono text-[10px] text-muted-foreground">
          {log.length ? log.join("\n") : "Napló…"}
        </pre>
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

type Summary = { kind: Kind; text: string };

// One line for the whole bottom area: the upload while it runs, otherwise what the actions (started here or elsewhere) are doing.
function stateSummary(o: { stage: number; step: string; pct: number; runs: Run[]; building: boolean; hasRepo: boolean }): Summary & { progress: boolean } {
  if (!o.hasRepo) return { kind: "idle", text: "Válassz repót", progress: false };
  if (o.stage === 1 || o.stage === 2) return { kind: "running", text: `${o.stage === 1 ? "Start" : "Process"} · ${o.step} · ${o.pct}%`, progress: true };
  if (o.stage === -1) return { kind: "failure", text: `Hiba · ${o.step}`, progress: false };
  if (!o.runs.length && !o.building && o.stage === 3) return { kind: "success", text: "Feltöltve · nincs futó action", progress: false };
  return { ...buildSummary(o.runs, o.building), progress: false };
}

// What the actions do right now: the running step, otherwise how they ended.
function buildSummary(runs: Run[], building: boolean): Summary {
  if (!runs.length) return building ? { kind: "running", text: "Várakozás a GitHubra…" } : { kind: "idle", text: "Nincs futó action" };
  const running = runs.filter((r) => r.status !== "completed");
  if (running.length) {
    const r = running[0]!;
    const j = r.jobs.find((x) => x.status !== "completed") ?? r.jobs[0];
    const step = j?.steps.find((x) => x.status === "in_progress");
    const done = j ? j.steps.filter((x) => x.status === "completed").length : 0;
    const where = [r.name, j && j.name !== r.name ? j.name : "", step?.name ?? (j ? "várakozás" : r.status === "queued" ? "sorban áll" : r.status === "pending" ? "előző futásra vár" : "")].filter(Boolean).join(" · ");
    return { kind: kindOf(r.status, r.conclusion), text: `${where}${j?.steps.length ? ` (${done}/${j.steps.length})` : ""}${running.length > 1 ? ` +${running.length - 1}` : ""}` };
  }
  const bad = runs.filter((r) => r.conclusion && !["success", "skipped", "cancelled"].includes(r.conclusion));
  if (bad.length) return { kind: "failure", text: `${bad[0]!.name}: ${bad[0]!.conclusion}${bad.length > 1 ? ` +${bad.length - 1}` : ""}` };
  return { kind: "success", text: `Kész · ${runs.length} futás` };
}
function safe<T>(f: () => T, d: T): T { try { return f(); } catch { return d; } }
