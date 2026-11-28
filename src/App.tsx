import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Bell, ChevronDown, Copy, Download, Maximize2, Minimize2, RefreshCw, X } from "lucide-react";
import { GitHub, planZip, type FileOp, type LatestRelease, type Plan, type Repo, type Run } from "@/lib/github";
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
import { LogLines } from "@/LogLines";
import { pollDelay, errorDelay } from "@/lib/cadence";
import { ConfirmDialog } from "@/ConfirmDialog";
import { UpdateDialog, type UpdateStatus } from "@/UpdateDialog";
import { downloadAndInstall, installedVersionCode, latestAppRelease, needsUpdate, releaseRepository, type AppRelease } from "@/lib/ota";
import { buildNote, liveNotes, noteTime, type Note } from "@/lib/notes";
import { getTrack, patchTrack, logFor, clearLog, type Tracks, type Track, type LogEntry } from "@/lib/build-track";


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
  // A build-követés repónként külön él (src/lib/build-track.ts): egy másik repóban követett build nem foglalja le ennek a
  // repónak a Build gombját. A ref a „most” állapota az aszinkron körökhöz, a state csak a megjelenítéshez kell.
  const [tracks, setTracks] = useState<Tracks>({});
  const tracksRef = useRef<Tracks>({});
  const setTrack = (r: string, p: Partial<Track>) => { tracksRef.current = patchTrack(tracksRef.current, r, p); setTracks(tracksRef.current); };
  const pollers = useRef(new Map<string, { stop: () => void; wake: () => void }>()); // repónként egy build-követő
  const startTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>()); // az indítás utáni 3 mp-es várakozás
  const phasesByRepo = useRef<Record<string, Record<string, string>>>({});
  const phasesFor = (r: string) => (phasesByRepo.current[r] ??= {});
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
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [release, setRelease] = useState<LatestRelease | null>(null);
  const [relTick, setRelTick] = useState(0);
  const [seenId, setSeenId] = useState<string | undefined>();
  const [active, setActive] = useState<Run[]>([]);
  const activeRef = useRef<Run[]>([]);
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
  // Minden naplósor egy repóhoz tartozik: a háttérben követett repó sorai nem kerülnek a most megnyitott naplójába.
  const addTo = (r: string, s: string) => setLogEntries((l) => [...l, { repo: r, text: `${new Date().toLocaleTimeString()}  ${s}` }]);
  const add = (s: string) => addTo(repo, s);
  const repoRef = useRef("");
  repoRef.current = repo;
  const tr = getTrack(tracks, repo);
  const { runs, building } = tr;
  const log = useMemo(() => logFor(logEntries, repo), [logEntries, repo]);

  // Build status strip: one line with the current step; tapping it drops down the full run list.
  // Any tap outside the strip/dropdown folds it back.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // Értesítések a lezárult buildekről (harang a fejlécben): megnézés után, a lista bezárásakor eltűnnek.
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const notesRef = useRef<HTMLDivElement>(null);
  const noteId = useRef(0);
  // Egy futásról egyszer jön értesítés, akkor is, ha a build-követő és a figyelő is látta lezárulni.
  const notified = useRef(new Set<number>());
  const notify = (r: string, rs: { id: number; name: string; status: string; conclusion: string | null }[]) => {
    const fresh = rs.filter((x) => !notified.current.has(x.id));
    if (!fresh.length) return;
    fresh.forEach((x) => notified.current.add(x.id));
    setNotes((l) => [buildNote(++noteId.current, r, fresh, Date.now()), ...l]);
  };
  const closeNotes = () => { setNotesOpen(false); setNotes([]); };
  // Appon belüli frissítés (csak az Android APK-ban): induláskor, előtérbe lépéskor (legfeljebb 10 percenként) és kézzel keres.
  const [update, setUpdate] = useState<AppRelease | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(0); // az elhalasztott kiadás build száma: újabbnál újra felugrik
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [updatePercent, setUpdatePercent] = useState<number | null>(null);
  const [updateCheck, setUpdateCheck] = useState<"idle" | "checking" | "latest" | "error">("idle");
  const lastUpdateCheck = useRef(0);
  async function checkUpdate(manual: boolean) {
    const r = releaseRepository();
    if (!r) { if (manual) setUpdateCheck("error"); return; }
    if (manual) setUpdateCheck("checking");
    try {
      const [rel, installed] = await Promise.all([latestAppRelease(gh, r), installedVersionCode()]);
      if (rel && needsUpdate(installed, rel.versionCode)) {
        setUpdate(rel); setUpdateCheck("idle");
        if (manual) setUpdateDismissed(0); // kézi kereséskor újra felugrik az ablak
      } else setUpdateCheck(manual ? "latest" : "idle");
    } catch { setUpdateCheck(manual ? "error" : "idle"); }
  }
  async function startUpdate() {
    if (!update || updateStatus === "downloading") return;
    setUpdateStatus("downloading"); setUpdatePercent(null);
    const state = await downloadAndInstall(update.apk, setUpdatePercent);
    if (state === "installing") { setUpdateStatus("idle"); setUpdateDismissed(update.versionCode); } // megnyílt a rendszer telepítője
    else setUpdateStatus(state === "needsPermission" ? "permission" : "failed");
  }
  useEffect(() => {
    if (!isNative() || !releaseRepository()) return;
    const look = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastUpdateCheck.current < 10 * 60 * 1000) return;
      lastUpdateCheck.current = Date.now();
      void checkUpdate(false);
    };
    look();
    document.addEventListener("visibilitychange", look);
    return () => document.removeEventListener("visibilitychange", look);
  }, [gh]);
  useEffect(() => {
    if (!notesOpen) return;
    const out = (e: PointerEvent) => { if (!notesRef.current?.contains(e.target as Node)) closeNotes(); };
    document.addEventListener("pointerdown", out);
    return () => document.removeEventListener("pointerdown", out);
  }, [notesOpen]);
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
    setBranches([]); // az előző repó ágai ne maradjanak a listában, amíg az újak megérkeznek
    let alive = true;
    gh.listBranches(repo).then((b) => { if (alive) setBranches(b); });
    return () => { alive = false; };
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

  // Leállítás kérve egy-egy futásra (a Leállítás gombbal, vagy a build sáv listájából): futásonként követjük, mikor kérték.
  const [stopReq, setStopReq] = useState<Record<number, number>>({});
  const [, setStopTick] = useState(0);
  const markStopped = (ids: number[]) => setStopReq((p) => ({ ...p, ...Object.fromEntries(ids.map((id) => [id, Date.now()])) }));
  const clearStopReq = (ids: number[]) => setStopReq((p) => {
    if (!ids.some((id) => id in p)) return p;
    const n = { ...p };
    ids.forEach((id) => delete n[id]);
    return n;
  });
  // Minden futás egyben: amit a build sáv követ (Build gomb, feltöltés utáni futások) és amit a figyelő talált (push, más gép).
  const allRuns = [...runs, ...active.filter((a) => !runs.some((r) => r.id === a.id))];
  const openAll = allRuns.filter((x) => x.status !== "completed");
  // A leállítást kért futás még látszik a listában, amíg a GitHub tényleg le nem állítja, de nem tartja fogva a gombot:
  // a Build gomb azonnal visszaáll, új build indulhat. Csak a még nem leállított futások számítanak „futónak”.
  const stoppable = openAll.filter((x) => !stopReq[x.id]);
  const running = building || stoppable.length > 0;
  const anyStopReq = Object.keys(stopReq).length > 0;
  // A harang listája: elöl a most futó buildek (élő sorok, a futás állapotából), utána a lezárultak. A lista bezárása csak a lezártakat törli.
  const liveNote = liveNotes(tracks, { repo, runs: active }, (id) => !!stopReq[id], Date.now());
  const shownNotes = [...liveNote, ...notes];
  useEffect(() => {
    if (!anyStopReq) return;
    // 15 mp után megjelenik a futás melletti „kényszerít”; a 10 percnél régebbi jelzések eltűnnek (elakadt leállítás újra leállíthatóként látszik).
    const id = setInterval(() => {
      setStopTick((n) => n + 1);
      setStopReq((prev) => {
        const next = Object.fromEntries(Object.entries(prev).filter(([, t]) => Date.now() - t < 600000));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 3000);
    return () => clearInterval(id);
  }, [anyStopReq]);
  useEffect(() => {
    // A lezárult futások jelzése megszűnik (a figyelő a saját lezárultjait külön törli).
    const done = runs.filter((x) => x.status === "completed").map((x) => x.id);
    if (done.length) clearStopReq(done);
  }, [runs]);
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
          const { open: now, closed } = await gh.runsOverview(repo, ticks++ % 6 === 0, panelIds.current); // a teljes (szűrt listás) keresés csak minden 6. körben; a build-követő futásait nem kérdezzük le másodszor
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
            logPhases(done, actPhases.current, repo);
            add(`ACTION KÉSZ ${done.length ? outcome(done.map((x) => x.conclusion)) : "■"}: ${done.map((x) => `${x.name} → ${x.conclusion ?? x.status}`).join(", ") || "lefutott"}`);
            notify(repo, done); // a harangban a futó sor helyére a végeredmény kerül
            gone.forEach((x) => { tracked.delete(x.id); seenDone.add(x.id); });
            clearStopReq(gone.map((x) => x.id));
            setRelTick((n) => n + 1);
          }
          // Ami úgy futott le, hogy nem láttuk futni (gyors futás, két lekérdezés között): legalább az eredményét jelezzük.
          const unseen = closed.filter((x) => !seenDone.has(x.id));
          if (!first_) {
            const quick = unseen.filter((x) => !tracked.has(x.id) && !panelIds.current.has(x.id));
            if (quick.length) { add(`Action lefutott: ${quick.map((x) => `${x.name} → ${x.conclusion ?? x.status}`).join(", ")}`); notify(repo, quick); setRelTick((n) => n + 1); }
          }
          unseen.forEach((x) => seenDone.add(x.id));
          logPhases(mine, actPhases.current, repo);
          activeRef.current = mine;
          setActive(mine);
          errs = 0;
          // Minél gyorsabban látszódjon az állapot: indulás után 1 mp, utána 8 mp (a kérés-korlát miatt nem sűrítjük tovább).
          delay = pollDelay({ sinceOpenMs: Date.now() - t0 });
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
  // A commit üzenet, a ZIP és a diff kiürül a sikeres végrehajtás után, és ha másik repót választunk.
  function resetInputs() {
    setMessage(""); setZipFiles([]); setZipName(""); setPatch("");
    setExpanded(false); setPanel(null); setBig(false); closing.current = false;
  }
  const prevRepo = useRef("");
  useEffect(() => {
    if (prevRepo.current && prevRepo.current !== repo) {
      resetInputs();
      if (!busy) { setStage(0); setStep(""); setPct(0); } // az előző repó feltöltésének állapota nem a most megnyitotté
    }
    prevRepo.current = repo;
  }, [repo]);

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

  // Build-követés: repónként egy önálló lekérdező, amely a háttérben is megy, ha közben másik repót nyitunk meg.
  // Csak a saját repója állapotát írja (tracks[repo], napló[repo]), így a többi repó Build gombját nem érinti.
  function stopTracking(r: string) {
    const st = startTimers.current.get(r);
    if (st) { clearTimeout(st); startTimers.current.delete(r); }
    pollers.current.get(r)?.stop();
    pollers.current.delete(r);
  }

  function startTracking(r: string, br: string, since: string) {
    stopTracking(r);
    setTrack(r, { since });
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let t0 = Date.now();
    let fails = 0;
    let running = false;
    let finished = false; // lezárult a build: további lekérdezés nem kell
    const tick = async () => {
      if (stop || running || finished) return;
      running = true;
      try {
        const rs = await gh.buildStatus(r, br, since);
        if (stop) return;
        fails = 0;
        // Mégse, még mielőtt a futás megjelent: amint megjelenik, leállítjuk (és a gombot nem foglalja le).
        if (tracksRef.current[r]?.cancelWanted) {
          const open = rs.filter((x) => x.status !== "completed");
          if (open.length) { markStopped(open.map((x) => x.id)); setTrack(r, { cancelWanted: false }); void cancelOpen(open, false, r); }
        }
        setTrack(r, { runs: rs });
        logPhases(rs, phasesFor(r), r);
        clearStopReq(rs.filter((x) => x.status === "completed").map((x) => x.id));
        const done = rs.length > 0 && rs.every((x) => x.status === "completed");
        if (done) {
          finished = true;
          setTrack(r, { building: false, cancelWanted: false });
          addTo(r, `BUILD KÉSZ ${outcome(rs.map((x) => x.conclusion))}: ${rs.map((x) => `${x.name} → ${x.conclusion}`).join(", ")}`);
          notify(r, rs);
          if (repoRef.current === r) setRelTick((n) => n + 1);
          return;
        }
        // Ne ragadjon be: ha 2 percig nem indult futás, vagy 45 percnél tovább tart, feladjuk a várakozást.
        if (!rs.length && Date.now() - t0 > 120000) { const was = tracksRef.current[r]?.building; setTrack(r, { building: false, cancelWanted: false }); if (was) addTo(r, "Nem indult build ebben a 2 percben. Nézd meg az Actions oldalt, vagy indíts újat."); return; }
        if (Date.now() - t0 > 45 * 60000) { setTrack(r, { building: false, cancelWanted: false }); addTo(r, "A build követése időtúllépés miatt leállt (45 perc). A ↻ gombbal újra lekérdezheted."); return; }
      } catch (e: any) {
        fails++;
        if (fails === 1 || fails % 10 === 0) addTo(r, `Build állapot hiba: ${e.message}`);
      } finally { running = false; }
      if (!stop) timer = setTimeout(tick, fails ? Math.min(2000 * 2 ** Math.min(fails, 4), 30000) : pollDelay({ sinceOpenMs: Date.now() - t0 }));
    };
    // Visszalépéskor / kézi frissítéskor azonnal újra lekérdez (a háttérben az időzítők lassulnak). A feladott követés újraindul.
    const wake = () => {
      if (stop || finished || document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      if (Date.now() - t0 > 45 * 60000 || !tracksRef.current[r]?.building) t0 = Date.now();
      void tick();
    };
    document.addEventListener("visibilitychange", wake);
    pollers.current.set(r, { stop: () => { stop = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", wake); }, wake });
    void tick();
  }
  useEffect(() => () => {
    pollers.current.forEach((x) => x.stop()); pollers.current.clear();
    startTimers.current.forEach((x) => clearTimeout(x)); startTimers.current.clear();
  }, []);

  // Az új build fázisait folyamatosan a naplóba írja (csak a változásokat).
  function logPhases(rs: Run[], ph: Record<string, string>, r: string) {
    const note = (k: string, v: string, line: string) => { if (ph[k] !== v) { ph[k] = v; addTo(r, line); } };
    rs.forEach((x) => {
      const st = x.conclusion ?? x.status;
      note(`r${x.id}`, st, `${x.status === "completed" ? `${outcome([x.conclusion])} ` : ""}${x.name}: ${st === "queued" ? "sorban áll" : st === "in_progress" ? "fut" : st}`);
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
    pollers.current.get(repo)?.wake();
    void pokeRef.current?.();
  }

  async function build() {
    const r = repo, br = branch;
    stopTracking(r);
    phasesByRepo.current[r] = {};
    setTrack(r, { since: "", runs: [], building: true, cancelWanted: false });
    const t = new Date(Date.now() - 5000).toISOString().replace(/\.\d+Z$/, "Z");
    try {
      const res = await gh.startBuild(r, br);
      addTo(r, `BUILD START → ${res.started.length ? res.started.join(", ") : "nincs kézzel indítható workflow, a feltöltés által indítottakat követem"}`);
      if (res.skipped.length) addTo(r, `  (kihagyva, nincs workflow_dispatch: ${res.skipped.join(", ")})`);
      startTimers.current.set(r, setTimeout(() => { startTimers.current.delete(r); startTracking(r, br, t); }, 3000));
    } catch (e: any) { addTo(r, `Build hiba: ${e.message}`); setTrack(r, { building: false }); }
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

  async function cancelOpen(rs: Run[], force: boolean, r: string = repo) {
    const stopped = await Promise.all(rs.map(async (x) => {
      try { await gh.cancelRun(r, x.id, force); return x.name; }
      catch (e: any) {
        if (e?.status === 409) return null; // közben lezárult
        clearStopReq([x.id]); // nem sikerült: újra leállíthatónak látszik
        addTo(r, `Leállítás hiba (${x.name}): ${e.message}`);
        return null;
      }
    }));
    const ok = stopped.filter(Boolean);
    if (ok.length) addTo(r, `${force ? "KÉNYSZERÍTETT LEÁLLÍTÁS" : "LEÁLLÍTÁS"} kérve: ${ok.join(", ")}`);
  }

  // Ugyanaz a gomb: Build → futás közben Leállítás (minden futó action, bárhol indult) → a leállítás kérése után azonnal
  // újra Build: nem kell megvárni, amíg a GitHub ténylegesen leállítja a futást (az addig a listában „leáll…”-ként látszik,
  // és ott külön kényszeríthető).
  async function stopBuild() {
    const r = repo;
    const open = stoppable;
    if (!open.length) {
      // Még nem jelent meg a futás a GitHubon: amint megjelenik, leállítjuk, a gomb pedig már most visszaáll.
      setTrack(r, { cancelWanted: true, building: false });
      add("MÉGSE: a build leáll, amint megjelenik a GitHubon.");
      return;
    }
    const names = open.map((x) => `${x.name} (${x.event})`).join(", ");
    if (!window.confirm(`Leállítod az összes futó actiont? (${names})`)) return;
    markStopped(open.map((x) => x.id));
    // A leállítás kérése után a Build gomb azonnal visszaáll: a „build tart” jelző megszűnik, a követés (poller) viszont
    // tovább fut, így a napló és a futáslista mutatja, amíg a GitHub tényleg le nem állítja a futásokat.
    setTrack(r, { building: false, cancelWanted: false });
    await cancelOpen(open, false, r);
    pollers.current.get(r)?.wake(); // az új állapot azonnal látszik
    void pokeRef.current?.();
  }

  // Bármelyik futó action leállítható, akkor is, ha nem a Build gombbal indult (push, másik gép, GitHub-oldal).
  async function stopActive(r: Run, force = false) {
    const q = force ? `A leállítás nem hatott. Kényszeríted a leállítást? (${r.name})` : `Leállítod a futó action-t? (${r.name}, ${r.event})`;
    if (!window.confirm(q)) return;
    markStopped([r.id]);
    // Ha ez volt az utolsó leállítható futás, a Build gomb itt is azonnal visszaáll (a követés tovább megy).
    if (!stoppable.some((x) => x.id !== r.id)) setTrack(repo, { building: false, cancelWanted: false });
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
    setStage(1); setPct(0); setStep("Előkészítés"); setLogEntries((l) => clearLog(l, repo));
    stopTracking(repo); setTrack(repo, { since: "", runs: [], building: false, cancelWanted: false });
    add(`START → ${repo}@${branch}`);
    try {
      if (tab === "zip") {
        if (!zipFiles.length) throw new Error("Nincs ZIP betöltve.");
        add(`Feltöltés: ${zipFiles.length} fájl → ${repo}@${branch} (${mode === "replace" ? "teljes csere" : "beillesztés"})`);
        setStep("Összevetés a repó jelenlegi állapotával");
        const { files: remote, modes, truncated } = await gh.getTree(repo, branch);
        if (truncated && mode === "replace") throw new Error("A repó túl nagy a teljes összevetéshez (a GitHub csonkolta a fájllistát), ezért teljes cserét nem végzek. Használd a Beillesztés módot.");
        const plan = await planZip(zipFiles, remote, mode);
        // Ami már pontosan így van a repóban, azt is be lehet tenni újra: üres commit készül, ami újraindítja a push-ra figyelő workflow-kat.
        if (!plan.added.length && !plan.modified.length && !plan.deleted.length) add("Nincs tartalmi változás: a ZIP megegyezik a repó jelenlegi állapotával. Üres commit készül.");
        if (!(await ask(plan))) throw new Error("Megszakítva.");
        setStage(2);
        // Unchanged files keep their existing blob: no need to upload them again.
        const dirty = new Set([...plan.added, ...plan.modified]);
        const toSend = zipFiles.filter((f) => dirty.has(f.path));
        // A már létező fájlok megtartják a módjukat (futtatható bit, szimbolikus link): a teljes csere ne írja át őket.
        const withMode = (f: { path: string; sha: string }): FileOp => (modes[f.path] ? { ...f, mode: modes[f.path]! } : f);
        const done: FileOp[] = zipFiles.filter((f) => !dirty.has(f.path) && remote[f.path]).map((f) => withMode({ path: f.path, sha: remote[f.path]! }));
        const B = 20;
        for (let k = 0; k < toSend.length; k += B) {
          const batch = toSend.slice(k, k + B);
          setStep(`Fájlok küldése ${k + batch.length}/${toSend.length}`);
          done.push(...(await gh.uploadBlobs(repo, batch)).map(withMode));
          batch.forEach((f) => add(`  ↑ ${f.path}`));
          setPct(Math.round(((k + batch.length) / toSend.length) * 90));
        }
        setStep("Commit létrehozása és ág frissítése");
        add("Commit létrehozása…");
        const r = await gh.commitFiles({ repo, branch, mode, message: message || `Upload ${zipName}`, files: done });
        add(r.empty ? `FINISH ✔ üres commit (nincs tartalmi változás) · ${r.url}` : `FINISH ✔ ${r.count} fájl · ${r.url}`);
      } else {
        const t = patchTargets(patch);
        if (!t.length) throw new Error("A patch nem tartalmaz fájlt.");
        const paths = [...new Set(t.map((x) => x.oldPath).filter(Boolean) as string[])];
        setStage(2); setStep("Eredeti fájlok letöltése"); setPct(20);
        add(`Patch: ${t.length} fájl, eredeti tartalom letöltése…`);
        const src = await gh.getFiles(repo, branch, paths);
        const modes = await gh.getTree(repo, branch).then((t) => t.modes, () => ({} as Record<string, string>)); // a módosított fájl megtartja a módját
        const { ops, errors, skipped } = applyPatchText(patch, src);
        skipped.forEach((f) => add(`  = ${f}: már így van a repóban, nincs mit módosítani`));
        errors.forEach((e) => add(e));
        if (errors.length) throw new Error("A patch nem minden része illeszthető, semmi sem lett feltöltve.");
        if (!ops.length) add("Nincs tartalmi változás: a diff már alkalmazva van. Üres commit készül.");
        ops.forEach((o) => add(`  ${o.delete ? "−" : "~"} ${o.path}`));
        const pl: Plan = { added: [], modified: [], deleted: [], unchanged: 0 };
        ops.forEach((o) => (o.delete ? pl.deleted : src[o.path] == null ? pl.added : pl.modified).push(o.path));
        if (!(await ask(pl))) throw new Error("Megszakítva.");
        setStep("Commit létrehozása és ág frissítése"); setPct(70);
        const r = await gh.commitFiles({
          repo, branch, mode: "merge", message: message || "Apply patch",
          files: ops.map((o): FileOp => (o.delete ? { path: o.path, delete: true } : { path: o.path, base64: toBase64(o.content ?? ""), ...(modes[o.path] ? { mode: modes[o.path]! } : {}) })),
        });
        add(r.empty ? `FINISH ✔ üres commit (nincs tartalmi változás) · ${r.url}` : `FINISH ✔ ${r.count} módosítás · ${r.url}`);
      }
      setStage(3); setPct(100); setStep("Kész");
      resetInputs();
      setTimeout(() => pokeRef.current?.(), 5000);
    } catch (e: any) {
      if (e?.message === "Megszakítva.") {
        add("Megszakítva.");
        setStage(0); setStep("");
      } else {
        add(`HIBA ✖ ${e.message ?? e}`);
        setStage(-1); setStep(String(e?.message ?? "Megszakadt"));
      }
    } finally {
      setBusy(false);
    }
  }

  const sum = stateSummary({ stage, step, pct, runs: allRuns, building, hasRepo: !!repo });

  return (
    <>
    {confirm && <ConfirmDialog plan={confirm.plan} repo={repo} branch={branch} mode={tab === "patch" ? "patch" : mode === "replace" ? "teljes csere" : "beillesztés"}
      onOk={() => { confirm.resolve(true); setConfirm(null); }} onCancel={() => { confirm.resolve(false); setConfirm(null); }} />}
    {update && !confirm && updateDismissed !== update.versionCode && (
      <UpdateDialog release={update} status={updateStatus} percent={updatePercent} onInstall={() => void startUpdate()}
        onLater={() => { setUpdateDismissed(update.versionCode); setUpdateStatus("idle"); }} />
    )}
    <main className="app-insets flex h-[100dvh] flex-col overflow-hidden text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-y-1.5 px-3 py-[5px]">
        <Brand className="hdr-brand" />
        <div className="hdr-profile relative flex items-center gap-2">
        <div ref={notesRef}>
          <button type="button" onClick={() => { if (notesOpen) closeNotes(); else { setMenuOpen(false); setNotesOpen(true); } }} aria-haspopup="dialog" aria-expanded={notesOpen} aria-label={shownNotes.length ? `Értesítések (${shownNotes.length})` : "Értesítések"} title="Értesítések" className={`relative flex h-8 w-8 items-center justify-center rounded-full bg-card ${shownNotes.length ? "text-foreground" : "text-muted-foreground"}`}>
            <Bell className="h-4 w-4" aria-hidden="true" />
            {shownNotes.length > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] font-bold leading-none text-primary-foreground">{shownNotes.length}</span>}
          </button>
          {notesOpen && (
            <div role="dialog" aria-label="Értesítések" className="absolute right-0 top-full z-30 mt-1.5 max-h-[min(20rem,60dvh)] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-popover p-1.5 shadow-2xl">
              {shownNotes.length ? shownNotes.map((n) => (
                <button key={n.live ? `live:${n.repo}` : n.id} type="button" onClick={() => { setRepo(n.repo); closeNotes(); }} className="flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left font-mono text-[11px]">
                  <span className="mt-px"><StatusIcon kind={n.kind} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2"><span className="truncate font-bold text-foreground">{n.repo}</span><span className="shrink-0 text-muted-foreground">{noteTime(n.at)}</span></span>
                    <span className="block break-words text-muted-foreground">{n.text}</span>
                  </span>
                </button>
              )) : <div className="px-3 py-2 font-mono text-[11px] text-muted-foreground">Nincs új értesítés.</div>}
            </div>
          )}
        </div>
        <div ref={menuRef}>
          <button type="button" onClick={() => { if (notesOpen) closeNotes(); setUpdateCheck((c) => (c === "checking" ? c : "idle")); setMenuOpen((o) => !o); }} aria-haspopup="menu" aria-expanded={menuOpen} className="flex h-8 items-center gap-1.5 rounded-full bg-card py-1 pl-1 pr-2.5 font-mono text-xs text-muted-foreground">
            {me ? <><img src={me.avatar} alt="" className="h-6 w-6 rounded-full" /><span className="text-foreground">{me.login}</span></> : <span className="pl-1.5">Bejelentkezés…</span>}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${menuOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 top-full z-30 mt-1.5 w-56 rounded-2xl border border-border bg-popover p-1.5 shadow-2xl">
              {me && <div className="truncate px-3 py-1.5 font-mono text-[11px] text-muted-foreground">Bejelentkezve: {me.login}</div>}
              {isNative() && (import.meta.env["VITE_APP_VERSION"] as string | undefined) && <div className="truncate px-3 pb-1 font-mono text-[11px] text-muted-foreground">RepoPush {import.meta.env["VITE_APP_VERSION"] as string}</div>}
              {isNative() && releaseRepository() && (
                <button type="button" role="menuitem" disabled={updateCheck === "checking"} onClick={() => { if (update) { setUpdateDismissed(0); setMenuOpen(false); } else void checkUpdate(true); }} className="w-full rounded-xl px-3 py-2.5 text-left font-mono text-sm disabled:opacity-60">
                  {updateCheck === "checking" ? "Keresés…" : update ? `Új verzió: ${update.version}` : updateCheck === "latest" ? "A legújabb verzió van telepítve" : updateCheck === "error" ? "A frissítés most nem érhető el" : "Frissítés keresése"}
                </button>
              )}
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); if (window.confirm("Kijelentkezel és törlöd a tokent erről az eszközről?")) onLogout(); }} className="w-full rounded-xl px-3 py-2.5 text-left font-mono text-sm text-destructive">Kijelentkezés</button>
            </div>
          )}
        </div>
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
              <div className="max-w-full break-all font-mono text-sm">{zipName || "ZIP behúzása / tallózás"}</div>
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
              <div className="land-targets max-h-[4.5rem] overflow-y-auto break-all font-mono text-xs text-muted-foreground">
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
              <div style={{ maxHeight: ddMax }} className="absolute left-1.5 right-1.5 top-full z-10 mt-1 flex min-h-[3.75rem] flex-col space-y-1.5 overflow-auto rounded-2xl border border-border bg-background/95 p-2 shadow-xl backdrop-blur-md">
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
                {/* Napló másolása: lebegő gomb a panel jobb alsó sarkában, nem foglal helyet a futások listájától. */}
                <div className="sticky bottom-0 z-10 mt-auto h-0">
                  <button onClick={saveLog} title={isNative() ? "Napló másolása" : "Napló mentése"} aria-label={isNative() ? "Napló másolása" : "Napló mentése"} className="absolute bottom-1 right-0 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-lg backdrop-blur-md">
                    {isNative() ? <Copy className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}
          </div>
          <button onClick={refresh} title="Állapot frissítése" aria-label="Állapot frissítése" className="flex shrink-0 items-center justify-center rounded-xl border border-border px-2.5 py-1.5">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            disabled={!running && !repo}
            onClick={running ? stopBuild : build}
            data-haptic="medium"
            title={running ? "Az összes futó action leállítása" : "Friss build indítása"}
            className={`shrink-0 rounded-xl px-3 py-1.5 font-bold disabled:opacity-60 ${running ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}
          >
            {!running ? (runs.length ? "Új build" : "▶ Build") : stoppable.length ? "■ Leállítás" : "Mégse"}
          </button>
          {sum.progress && (
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="absolute inset-x-1.5 bottom-0 h-0.5 overflow-hidden rounded-full bg-border/40">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
        <pre ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-2 font-mono text-[10px] text-muted-foreground">
          {log.length ? <LogLines lines={log} /> : "Napló…"}
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

// Outcome mark for the log: ✔ if everything succeeded, ✖ if something failed, ■ if it was only stopped or skipped.
function outcome(cs: (string | null)[]): string {
  if (cs.some((c) => c && !["success", "skipped", "cancelled", "neutral"].includes(c))) return "✖";
  return cs.length && cs.every((c) => c === "success" || c === "skipped") ? "✔" : "■";
}

// One line for the whole bottom area: the upload while it runs, otherwise what the actions (started here or elsewhere) are doing.
function stateSummary(o: { stage: number; step: string; pct: number; runs: Run[]; building: boolean; hasRepo: boolean }): Summary & { progress: boolean } {
  if (!o.hasRepo) return { kind: "idle", text: "Válassz repót", progress: false };
  if (o.stage === 1 || o.stage === 2) return { kind: "running", text: `${o.stage === 1 ? "Start" : "Process"} · ${o.step} · ${o.pct}%`, progress: true };
  // A régi hiba nem takarhatja el azt, ami most fut (például a megszakadt feltöltés ellenére elindult build).
  const busy = o.building || o.runs.some((r) => r.status !== "completed");
  if (o.stage === -1 && !busy) return { kind: "failure", text: `Hiba · ${o.step}`, progress: false };
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
