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
  const [lifted, setLifted] = useState(""); // starred repo being reordered
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ pointerId: number; lastY: number; startY: number; travel: number; moved: boolean; rowName: string; canReorder: boolean } | null>(null);
  const drag = useRef({ name: "", lastY: 0, grab: 0, scrollV: 0, raf: 0 });
  const longPress = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const latest = useRef({ stars, exists: (_: string) => false, searching: false });
  const suppressClick = useRef(false);

  const byName = useMemo(() => new Map(repos.map((r) => [r.full_name, r])), [repos]);
  const needle = q.trim().toLowerCase();
  const match = (r: Repo) => !needle || r.full_name.toLowerCase().includes(needle);
  const starred = stars.map((n) => byName.get(n)).filter((r): r is Repo => !!r);
  const starredShown = starred.filter(match);
  const restShown = repos.filter((r) => !stars.includes(r.full_name) && match(r));
  const cur = byName.get(value);
  latest.current = { ...latest.current, stars, exists: (n: string) => byName.has(n), searching: !!needle };

  const update = (next: string[]) => { latest.current.stars = next; setStars(next); savePins(next); };
  const pick = (name: string) => { if (suppressClick.current) return; onChange(name); setOpen(false); };

  // Touch/pen scrolling, long-press reorder for starred repos, and select-on-release.
  const placeDraggedRow = () => {
    const el = list.current;
    const d = drag.current;
    if (!el || !d.name) return;
    const row = Array.from(el.querySelectorAll<HTMLElement>("[data-repo]")).find((item) => item.dataset.repo === d.name);
    if (!row) return;
    const natural = el.getBoundingClientRect().top - el.scrollTop + row.offsetTop;
    row.style.transform = `translateY(${d.lastY - d.grab - natural}px)`;
  };

  const reorderDraggedRow = () => {
    const el = list.current;
    const d = drag.current;
    if (!el || !d.name) return;
    const rows = Array.from(el.querySelectorAll<HTMLElement>('[data-starred="1"]'));
    const at = rows.findIndex((r) => r.dataset.repo === d.name);
    if (at < 0) return;
    const mids = rows.map((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2; });
    const to = dragTarget(mids, at, d.lastY);
    if (to !== at) {
      tap("light");
      const next = moveTo(latest.current.stars, latest.current.exists, d.name, to);
      latest.current.stars = next;
      setStars(next);
    }
  };

  const onListPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('input, button[aria-label="Csillag levétele"], button[aria-label="Csillagozás"]')) return;
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-repo]");
    const rowName = row?.dataset.repo ?? "";
    const canReorder = !!row && row.dataset.starred === "1" && !needle;
    gesture.current = { pointerId: e.pointerId, lastY: e.clientY, startY: e.clientY, travel: 0, moved: false, rowName, canReorder };
    if (canReorder && row) {
      if (longPress.current) window.clearTimeout(longPress.current);
      const pressedRow = row;
      const pointerId = e.pointerId;
      longPress.current = window.setTimeout(() => {
        const g = gesture.current;
        // Use the repo captured on pointer-down. The previous patch referenced an
        // undefined `name`, so the long-press callback crashed before lifting the row.
        if (!g || g.pointerId !== pointerId || g.moved || !g.canReorder || !g.rowName || !pressedRow.isConnected || latest.current.searching) return;
        drag.current.name = g.rowName;
        drag.current.lastY = g.lastY;
        drag.current.grab = g.startY - pressedRow.getBoundingClientRect().top;
        drag.current.scrollV = 0;
        setLifted(g.rowName);
        tap("medium");
      }, 420);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onListPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const delta = e.clientY - g.lastY;
    g.travel += Math.abs(delta);
    if (Math.abs(e.clientY - g.startY) > 10) {
      g.moved = true;
      if (longPress.current) { window.clearTimeout(longPress.current); longPress.current = null; }
    }
    const d = drag.current;
    if (d.name) {
      e.preventDefault();
      d.lastY = e.clientY;
      const bounds = e.currentTarget.getBoundingClientRect();
      d.scrollV = e.clientY < bounds.top + 48 ? -7 : e.clientY > bounds.bottom - 48 ? 7 : 0;
      if (d.scrollV) e.currentTarget.scrollTop += d.scrollV;
      reorderDraggedRow();
      placeDraggedRow();
      return;
    }
    if (g.moved) {
      e.preventDefault();
      // Begin slowly; sustained finger travel progressively increases the scroll response.
      const speed = 0.18 + Math.min(g.travel / 520, 0.62);
      e.currentTarget.scrollTop += delta * speed;
      const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-repo]");
      setFocus(row?.dataset.repo ?? "");
    }
    g.lastY = e.clientY;
  };

  const onListPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    if (longPress.current) { window.clearTimeout(longPress.current); longPress.current = null; }
    const d = drag.current;
    if (d.name) {
      const row = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-repo]")).find((item) => item.dataset.repo === d.name);
      if (row) row.style.transform = "";
      if (d.raf) cancelAnimationFrame(d.raf);
      d.name = ""; d.raf = 0; d.scrollV = 0;
      setLifted("");
      savePins(latest.current.stars);
      tap("light");
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 350);
      setFocus("");
      return;
    }
    const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const row = target?.closest<HTMLElement>("[data-repo]");
    const onStar = !!target?.closest('button[aria-label="Csillag levétele"], button[aria-label="Csillagozás"]');
    if (row && !onStar) {
      suppressClick.current = true;
      onChange(row.dataset.repo ?? "");
      window.setTimeout(() => {
        setOpen(false);
        suppressClick.current = false;
      }, 0);
    } else if (g.moved) {
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 250);
    }
    window.setTimeout(() => setFocus(""), 140);
  };

  const onListPointerCancel = () => {
    if (longPress.current) { window.clearTimeout(longPress.current); longPress.current = null; }
    const d = drag.current;
    if (d.name && list.current) {
      const row = Array.from(list.current.querySelectorAll<HTMLElement>("[data-repo]")).find((item) => item.dataset.repo === d.name);
      if (row) row.style.transform = "";
    }
    d.name = ""; d.scrollV = 0; d.raf = 0;
    gesture.current = null;
    setLifted(""); setFocus("");
  };

  useLayoutEffect(() => { if (drag.current.name) placeDraggedRow(); }, [stars]);

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
        <button type="button" role="option" aria-selected={selected} title={r.full_name} onClick={() => pick(r.full_name)} style={{ WebkitTapHighlightColor: "transparent" }} className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-3 text-left font-mono text-base">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center">{selected && <Check className="h-5 w-5 text-primary" />}</span>
          <span className={`min-w-0 flex-1 origin-left truncate transition duration-150 ease-[cubic-bezier(.2,1.5,.4,1)] ${pop ? "scale-[1.18]" : ""}`} style={pop ? { textShadow: `0 0 12px ${GLOW}` } : undefined}>{short(r.full_name)}</span>
          {r.private && <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="privát" />}
        </button>
        <button
          type="button"
          onClick={() => { if (!suppressClick.current) update(togglePin(stars, r.full_name)); }}
          aria-label={isStar ? "Csillag levétele" : "Csillagozás"}
          aria-pressed={isStar}
          style={{ WebkitTapHighlightColor: "transparent" }} className={`mr-1 flex h-12 w-11 shrink-0 items-center justify-center rounded-xl ${isStar ? "text-primary" : "text-muted-foreground"}`}
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
        <div className="repo-picker-list absolute left-0 top-full z-30 mt-2 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl">
          {repos.length > 8 && (
            <div className="mx-2 mt-2 flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 text-primary">
              <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Keresés…" aria-label="Repó keresése" className="min-w-0 flex-1 bg-transparent font-mono text-base text-primary outline-none placeholder:text-primary/60" />
            </div>
          )}
          <div
            ref={list}
            role="listbox"
            aria-label="Repók"
            onPointerDown={onListPointerDown}
            onPointerMove={onListPointerMove}
            onPointerUp={onListPointerUp}
            onPointerCancel={onListPointerCancel}
            onClickCapture={(e) => {
              if (suppressClick.current) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onContextMenu={(e) => e.preventDefault()}
            style={{ WebkitTapHighlightColor: "transparent" }} className="relative max-h-[min(66vh,30rem)] touch-none overflow-x-hidden overflow-y-auto overscroll-contain p-1.5"
          >
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
