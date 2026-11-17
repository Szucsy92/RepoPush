import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, Lock, Pin, Search } from "lucide-react";
import type { Repo } from "@/lib/github";
import { movePin, readPins, savePins, togglePin } from "@/lib/pins";

const short = (fullName: string) => fullName.split("/")[1] ?? fullName;

/** Repo dropdown in the app's theme: compact, scrollable, with repos that can be pinned to the top and reordered. */
export function RepoPicker({ repos, value, onChange }: { repos: Repo[]; value: string; onChange: (fullName: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pins, setPins] = useState<string[]>(readPins);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const byName = useMemo(() => new Map(repos.map((r) => [r.full_name, r])), [repos]);
  const needle = q.trim().toLowerCase();
  const match = (r: Repo) => !needle || r.full_name.toLowerCase().includes(needle);
  const pinned = pins.map((n) => byName.get(n)).filter((r): r is Repo => !!r);
  const pinnedShown = pinned.filter(match);
  const restShown = repos.filter((r) => !pins.includes(r.full_name) && match(r));
  const cur = byName.get(value);

  const update = (next: string[]) => { setPins(next); savePins(next); };
  const pick = (name: string) => { onChange(name); setOpen(false); };

  // Any tap outside (or Escape) folds the list back.
  useEffect(() => {
    if (!open) { setQ(""); return; }
    const out = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", out);
    document.addEventListener("keydown", esc);
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    return () => { document.removeEventListener("pointerdown", out); document.removeEventListener("keydown", esc); };
  }, [open]);

  const row = (r: Repo, isPinned: boolean, idx: number, count: number) => {
    const selected = r.full_name === value;
    const icon = "flex h-8 w-7 shrink-0 items-center justify-center rounded text-muted-foreground active:bg-secondary disabled:opacity-25";
    return (
      <li key={r.full_name} role="presentation" className={`flex items-center ${selected ? "bg-accent" : ""}`}>
        <button type="button" role="option" aria-selected={selected} title={r.full_name} onClick={() => pick(r.full_name)} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left font-mono text-xs active:bg-secondary">
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">{selected && <Check className="h-3.5 w-3.5 text-primary" />}</span>
          <span className="min-w-0 flex-1 truncate">{short(r.full_name)}</span>
          {r.private && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="privát" />}
        </button>
        {isPinned && !needle && (
          <>
            <button type="button" disabled={idx === 0} onClick={() => update(movePin(pins, (n) => byName.has(n), r.full_name, -1))} aria-label="Feljebb" className={icon}><ArrowUp className="h-3.5 w-3.5" /></button>
            <button type="button" disabled={idx === count - 1} onClick={() => update(movePin(pins, (n) => byName.has(n), r.full_name, 1))} aria-label="Lejjebb" className={icon}><ArrowDown className="h-3.5 w-3.5" /></button>
          </>
        )}
        <button type="button" onClick={() => update(togglePin(pins, r.full_name))} aria-label={isPinned ? "Rögzítés feloldása" : "Rögzítés felülre"} aria-pressed={isPinned} className={`${icon} mr-0.5 ${isPinned ? "text-primary!" : ""}`}>
          <Pin className={`h-3.5 w-3.5 ${isPinned ? "fill-current" : ""}`} />
        </button>
      </li>
    );
  };

  const head = "sticky top-0 z-[1] flex items-center gap-1 bg-background px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground";
  return (
    <div ref={root} className="relative min-w-0 flex-[2]">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} title={value || "Repó kiválasztása"} className={`field flex w-full items-center gap-1.5 text-left font-mono text-xs ${open ? "border-primary!" : ""}`}>
        {cur?.private && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="privát" />}
        <span className={`min-w-0 flex-1 truncate ${value ? "" : "text-muted-foreground"}`}>{value ? short(value) : repos.length ? "Repó kiválasztása" : "Betöltés…"}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-md border border-border bg-background shadow-lg">
          {repos.length > 8 && (
            <div className="flex items-center gap-1.5 border-b border-border px-2 py-1">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Keresés…" aria-label="Repó keresése" className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground" />
            </div>
          )}
          <div ref={list} role="listbox" aria-label="Repók" className="max-h-[min(60vh,24rem)] overflow-y-auto overscroll-contain">
            {pinnedShown.length > 0 && (
              <>
                <div className={head}><Pin className="h-2.5 w-2.5" aria-hidden="true" />Rögzítettek</div>
                <ul>{pinnedShown.map((r, i) => row(r, true, i, pinnedShown.length))}</ul>
              </>
            )}
            {restShown.length > 0 && (
              <>
                {pinnedShown.length > 0 && <div className={head}>Összes ({restShown.length})</div>}
                <ul>{restShown.map((r) => row(r, false, 0, 0))}</ul>
              </>
            )}
            {!pinnedShown.length && !restShown.length && <div className="px-2 py-3 text-center font-mono text-xs text-muted-foreground">{repos.length ? "Nincs találat" : "Betöltés…"}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
