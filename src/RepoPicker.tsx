import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Lock, Search, Star } from "lucide-react";
import type { Repo } from "@/lib/github";
import { tap } from "@/lib/haptics";
import { readPins, savePins, togglePin } from "@/lib/pins";

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
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ pointerId: number; lastY: number; startY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const byName = useMemo(() => new Map(repos.map((r) => [r.full_name, r])), [repos]);
  const needle = q.trim().toLowerCase();
  const match = (r: Repo) => !needle || r.full_name.toLowerCase().includes(needle);
  const starred = stars.map((n) => byName.get(n)).filter((r): r is Repo => !!r);
  const starredShown = starred.filter(match);
  const restShown = repos.filter((r) => !stars.includes(r.full_name) && match(r));
  const cur = byName.get(value);

  const update = (next: string[]) => { setStars(next); savePins(next); };
  const pick = (name: string) => { if (suppressClick.current) return; onChange(name); setOpen(false); };

  // Keep the existing dropdown and styling; only replace the list's gesture handling.
  const onListPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('input, button[aria-label="Csillag levétele"], button[aria-label="Csillagozás"]')) return;
    gesture.current = { pointerId: e.pointerId, lastY: e.clientY, startY: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onListPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const delta = e.clientY - g.lastY;
    if (Math.abs(e.clientY - g.startY) > 5) g.moved = true;
    if (g.moved) {
      e.preventDefault();
      // Match the source wheel picker: dragging the finger down advances down the list.
      e.currentTarget.scrollTop += delta;
      const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-repo]");
      setFocus(row?.dataset.repo ?? "");
    }
    g.lastY = e.clientY;
  };

  const onListPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const row = target?.closest<HTMLElement>("[data-repo]");
    const onStar = !!target?.closest('button[aria-label="Csillag levétele"], button[aria-label="Csillagozás"]');
    if (row && !onStar) {
      suppressClick.current = true;
      onChange(row.dataset.repo ?? "");
      setOpen(false);
      window.setTimeout(() => { suppressClick.current = false; }, 250);
    } else if (g.moved) {
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 250);
    }
    window.setTimeout(() => setFocus(""), 140);
  };

  const onListPointerCancel = () => { gesture.current = null; setFocus(""); };

  // Any tap outside (or Escape) folds the list back.
  useEffect(() => {
    if (!open) { setQ(""); setFocus(""); return; }
    const out = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", out);
    document.addEventListener("keydown", esc);
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    return () => { document.removeEventListener("pointerdown", out); document.removeEventListener("keydown", esc); };
  }, [open]);

  const row = (r: Repo, isStar: boolean) => {
    const selected = r.full_name === value;
    const pop = focus === r.full_name;
    return (
      <li
        key={r.full_name}
        role="presentation"
        data-repo={r.full_name}
        data-starred={isStar ? "1" : undefined}
        className={`relative flex select-none items-center rounded-xl duration-150 transition ${isStar ? "text-primary" : ""} ${selected ? "bg-accent" : ""} ${pop ? "z-10 bg-primary/15" : ""}`}
        style={{
          ...(pop ? { boxShadow: `0 0 22px -6px ${GLOW}` } : {}),
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
          <div
            ref={list}
            role="listbox"
            aria-label="Repók"
            onPointerDown={onListPointerDown}
            onPointerMove={onListPointerMove}
            onPointerUp={onListPointerUp}
            onPointerCancel={onListPointerCancel}
            onContextMenu={(e) => e.preventDefault()}
            className="relative max-h-[min(66vh,30rem)] touch-none overflow-x-hidden overflow-y-auto overscroll-contain p-1.5"
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
