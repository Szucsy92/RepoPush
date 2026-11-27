import { useMemo, useState } from "react";
import { ChevronDown, Lock } from "lucide-react";
import type { Repo } from "@/lib/github";
import { WheelPicker } from "@/WheelPicker";
import { readPins, savePins, togglePin } from "@/lib/pins";

const short = (fullName: string) => fullName.split("/")[1] ?? fullName;

/** Wheel-based GitHub repository selector, adapted from the Asset Mileage Compass picker. */
export function RepoPicker({ repos, value, onChange }: { repos: Repo[]; value: string; onChange: (fullName: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pinsRevision, setPinsRevision] = useState(0);
  const { items, names, selectedIndex, pinnedCount, pinnedIndices } = useMemo(() => {
    const byName = new Map(repos.map((repo) => [repo.full_name, repo]));
    const pins = readPins();
    const pinned = pins.map((name) => byName.get(name)).filter((repo): repo is Repo => !!repo);
    const rest = repos.filter((repo) => !pins.includes(repo.full_name));
    const ordered = [...pinned, ...rest];
    return {
      items: ordered.map((repo) => repo.full_name),
      names: ordered.map((repo) => repo.full_name),
      selectedIndex: ordered.findIndex((repo) => repo.full_name === value),
      pinnedCount: pinned.length,
      pinnedIndices: pinned.map((_, index) => index),
    };
  }, [repos, value, pinsRevision]);

  const togglePinned = (index: number) => {
    const name = names[index];
    if (!name) return;
    savePins(togglePin(readPins(), name));
    setPinsRevision((revision) => revision + 1);
  };

  const reorderPinned = (from: number, to: number) => {
    // Only pinned repositories are reorderable; unpinned repositories keep their API order.
    if (from >= pinnedCount || to >= pinnedCount) return;
    const live = names.slice(0, pinnedCount);
    const current = live[from];
    if (!current) return;
    const next = live.slice();
    next.splice(from, 1);
    next.splice(to, 0, current);
    const stale = pins.filter((name) => !names.includes(name));
    savePins([...next, ...stale]);
    setPinsRevision((revision) => revision + 1);
  };

  const current = repos.find((repo) => repo.full_name === value);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" title={value || "Repó kiválasztása"} className={`field picker flex w-full items-center gap-1.5 text-left font-mono text-xs ${value ? "picker-set" : "picker-idle"}`}>
        {current?.private && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="privát" />}
        <span className={`min-w-0 flex-1 truncate ${value ? "" : "text-muted-foreground"}`}>{value ? short(value) : repos.length ? "Repó kiválasztása" : "Betöltés…"}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      {open && <WheelPicker
      title="GitHub-repó kiválasztása"
      items={items}
      value={selectedIndex >= 0 ? selectedIndex : 0}
      searchable
      pinnedIndices={pinnedIndices}
      onTogglePin={togglePinned}
      onSelect={(index) => { const name = names[index]; if (name) onChange(name); setOpen(false); }}
      onReorder={pinnedCount > 1 ? reorderPinned : undefined}
      onClose={() => setOpen(false)}
    />}
    </>
  );
}
