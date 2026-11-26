import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Lock, Search, Star } from "lucide-react";
import type { Repo } from "@/lib/github";
import { tap } from "@/lib/haptics";
import { dragTarget, moveTo, readPins, savePins, togglePin } from "@/lib/pins";

const short = (fullName: string) => fullName.split("/")[1] ?? fullName;
const GLOW = "color-mix(in oklab, var(--primary) 60%, transparent)";

/**
 * Repo dropdown on one piece of frosted glass, no separators or bands. The search field and the starred repos are
 * highlighted with the theme colour. Dragging a finger scrolls the list, and the repo under the finger pops out (bigger text,
 * a little glow). A long press on a starred repo lifts it: drag it up or down to change the order.
 */
export function RepoPicker({ repos, value, onChange }: { repos: Repo[]; value: string; onChange: (fullName: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [stars, setStars] = useState<string[]>(readPins);
  const [focus, setFocus] = useState(""); // the repo under the finger: it pops out
  const [lifted, setLifted] = useState(""); // the repo that is being dragged to a new place
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const drag = useRef({ name: "", lastY: 0, grab: 0, scrollV: 0, raf: 0 });
  const place = useRef<() => void>(() => {});
  const suppressClick = useRef(false);

  const byName = useMemo(() => new Map(repos.map((r) => [r.full_name, r])), [repos]);
  const needle = q.trim().toLowerCase();
  const match = (r: Repo) => !needle || r.full_name.toLowerCase().includes(needle);
  const starred = stars.map((n) => byName.get(n)).filter((r): r is Repo => !!r);
  const starredShown = starred.filter(match);
  const restShown = repos.filter((r) => !stars.includes(r.full_name) && match(r));
  const cur = byName.get(value);

  // Latest values for the touch handlers (they are attached once while the list is open).
  const latest = useRef({ stars, exists: (_: string) => false, searching: false });
  latest.current = { stars, exists: (n: string) => byName.has(n), searching: !!needle };

  const update = (next: string[]) => { setStars(next); savePins(next); };
  const pick = (name: string) => { if (suppressClick.current) return; onChange(name); setOpen(false); };

  // Any tap outside (or Escape) folds the list back.
  useEffect(() => {
    if (!open) { setQ(""); setFocus(""); setLifted(""); return; }
    const out = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", out);
    document.addEventListener("keydown", esc);
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    return () => { document.removeEventListener("pointerdown", out); document.removeEventListener("keydown", esc); };
  }, [open]);

  // Touch: pop-out under the finger, and long press + drag to reorder the starred repos.
  useEffect(() => {
    const el = list.current;
    if (!open || !el) return;
    const st = drag.current;
    let timer = 0;
    let sx = 0, sy = 0;
    const rowAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-repo]") ?? null;
    const rowOf = (name: string) => el.querySelector<HTMLElement>(`[data-repo="${CSS.escape(name)}"]`);
    const setPop = (name: string) => setFocus((f) => (f === name ? f : name));

    // The dragged row follows the finger, wherever it currently sits in the list.
    place.current = () => {
      const row = st.name ? rowOf(st.name) : null;
      if (!row) return;
      const natural = el.getBoundingClientRect().top - el.scrollTop + row.offsetTop;
      row.style.transform = `translateY(${st.lastY - st.grab - natural}px)`;
    };
    // Past the neighbours the finger has crossed: swap places.
    const reorder = () => {
      const rows = Array.from(el.querySelectorAll<HTMLElement>('[data-starred="1"]'));
      const at = rows.findIndex((r) => r.dataset.repo === st.name);
      if (at < 0) return;
      const mids = rows.map((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2; });
      const to = dragTarget(mids, at, st.lastY);
      if (to !== at) {
        tap("light");
        setStars((s) => moveTo(s, latest.current.exists, st.name, to));
      }
    };
    const step = () => { reorder(); place.current(); };
    const autoScroll = () => {
      st.raf = 0;
      if (!st.name || !st.scrollV) return;
      el.scrollTop += st.scrollV;
      step();
      st.raf = requestAnimationFrame(autoScroll);
    };

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]!;
      sx = t.clientX; sy = t.clientY;
      const row = rowAt(sx, sy);
      const name = row?.dataset.repo ?? "";
      setPop(name);
      window.clearTimeout(timer);
      if (row && row.dataset.starred === "1" && !latest.current.searching) {
        timer = window.setTimeout(() => { // long press: lift the row
          st.name = name; st.lastY = sy; st.grab = sy - row.getBoundingClientRect().top; st.scrollV = 0;
          setLifted(name); tap("medium");
        }, 380);
      }
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0]!;
      if (st.name) { // dragging a starred row to reorder it
        e.preventDefault();
        st.lastY = t.clientY;
        const box = el.getBoundingClientRect();
        st.scrollV = t.clientY < box.top + 48 ? -7 : t.clientY > box.bottom - 48 ? 7 : 0;
        step();
        if (st.scrollV && !st.raf) st.raf = requestAnimationFrame(autoScroll);
        return;
      }
      const deltaY = t.clientY - sy;
      if (Math.hypot(t.clientX - sx, deltaY) > 8) {
        e.preventDefault();
        window.clearTimeout(timer);
        // Make the list follow the finger: dragging down moves the content down,
        // and dragging up moves it up.
        el.scrollTop += deltaY;
        sy = t.clientY;
        sx = t.clientX;
      }
      setPop(rowAt(t.clientX, t.clientY)?.dataset.repo ?? "");
    };
    const onEnd = (e: TouchEvent) => {
      window.clearTimeout(timer);
      if (st.name) {
        const row = rowOf(st.name);
        if (row) row.style.transform = "";
        if (st.raf) cancelAnimationFrame(st.raf);
        st.raf = 0; st.name = ""; st.scrollV = 0;
        setLifted("");
        savePins(latest.current.stars);
        tap("light");
        suppressClick.current = true; // the lift-off must not count as a tap on the repo
        window.setTimeout(() => { suppressClick.current = false; }, 350);
      } else if (e.type === "touchend" && !latest.current.searching) {
        // Pick the repo under the finger after the scroll gesture has finished.
        const t = e.changedTouches[0];
        const target = t ? document.elementFromPoint(t.clientX, t.clientY) : null;
        const row = target?.closest<HTMLElement>("[data-repo]") ?? null;
        if (row && !target?.closest('button[aria-label="Csillag levétele"], button[aria-label="Csillagozás"]')) {
          const option = row.querySelector<HTMLButtonElement>('[role="option"]');
          if (option) {
            suppressClick.current = true;
            onChange(row.dataset.repo ?? "");
            setOpen(false);
            window.setTimeout(() => { suppressClick.current = false; }, 350);
          }
        }
      }
      window.setTimeout(() => setFocus(""), 140);
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      window.clearTimeout(timer);
      if (st.raf) cancelAnimationFrame(st.raf);
      st.name = ""; st.raf = 0;
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [open]);
  // After the order changed, the lifted row is put back under the finger.
  useLayoutEffect(() => { if (drag.current.name) place.current(); }, [stars]);

  const row = (r: Repo, isStar: boolean) => {
    const selected = r.full_name === value;
    const pop = focus === r.full_name || lifted === r.full_name;
    return (
      <li
        key={r.full_name}
        role="presentation"
        data-repo={r.full_name}
        data-starred={isStar ? "1" : undefined}
        className={`relative flex select-none items-center rounded-xl duration-150 ${lifted === r.full_name ? "scale-[1.03]" : ""} ${lifted === r.full_name ? "" : "transition"} ${isStar ? "text-primary" : ""} ${selected ? "bg-accent" : ""} ${pop ? "z-10 bg-primary/15" : ""}`}
        style={{
          ...(pop ? { boxShadow: `0 0 22px -6px ${GLOW}` } : {}),
          ...(lifted === r.full_name ? { transition: "scale .15s, box-shadow .15s, background-color .15s" } : {}),
        }}
      >
        <button type="button" role="option" aria-selected={selected} title={r.full_name} onClick={() => pick(r.full_name)} className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-3 text-left font-mono text-base">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center">{selected && <Check className="h-5 w-5 text-primary" />}</span>
          <span className={`min-w-0 flex-1 origin-left truncate transition duration-150 ease-[cubic-bezier(.2,1.5,.4,1)] ${pop ? "scale-[1.18]" : ""}`} style={pop ? { textShadow: `0 0 12px ${GLOW}` } : undefined}>{short(r.full_name)}</span>
          {r.private && <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="privát" />}
        </button>
        <button
          type="button"
          onClick={() => { if (!suppressClick.current) update(togglePin(stars, r.full_name)); }}
          aria-label={isStar ? "Csillag levétele" : "Csillagozás"}
          aria-pressed={isStar}
          className={`mr-1 flex h-12 w-11 shrink-0 items-center justify-center rounded-xl ${isStar ? "text-primary" : "text-muted-foreground"}`}
        >
          <Star className={`h-5 w-5 ${isStar ? "fill-current" : ""}`} />
        </button>
      </li>
    );
  };

  return (
    <div ref={root} className="relative min-w-0 flex-[2]">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} title={value || "Repó kiválasztása"} className={`field picker flex w-full items-center gap-1.5 text-left font-mono text-xs ${value ? "picker-set" : "picker-idle"}`}>
        {cur?.private && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="privát" />}
        <span className={`min-w-0 flex-1 truncate ${value ? "" : "text-muted-foreground"}`}>{value ? short(value) : repos.length ? "Repó kiválasztása" : "Betöltés…"}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${value ? "text-primary" : "text-muted-foreground"} ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl">
          {repos.length > 8 && (
            <div className="mx-2 mt-2 flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 text-primary">
              <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Keresés…" aria-label="Repó keresése" className="min-w-0 flex-1 bg-transparent font-mono text-base text-primary outline-none placeholder:text-primary/60" />
            </div>
          )}
          <div ref={list} role="listbox" aria-label="Repók" onContextMenu={(e) => e.preventDefault()} className="relative max-h-[min(66vh,30rem)] touch-none overflow-x-hidden overflow-y-auto overscroll-contain p-1.5">
            <ul>
              {starredShown.map((r) => row(r, true))}
              {restShown.map((r) => row(r, false))}
            </ul>
            {!starredShown.length && !restShown.length && <div className="px-3 py-4 text-center font-mono text-base text-muted-foreground">{repos.length ? "Nincs találat" : "Betöltés…"}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
