// Starred repos (stored under the old "pins" key): the picker lists them first, top to bottom in the order they were starred,
// and they can be reordered by long-press + drag.
const KEY = "repopush.pins";

export function readPins(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}
export function savePins(p: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* nem kritikus */ }
}

/** Pins go to the end of the pinned list, so the list fills from the top down in the order they were pinned. */
export const togglePin = (pins: string[], name: string): string[] => (pins.includes(name) ? pins.filter((n) => n !== name) : [...pins, name]);

/** Moves a starred repo to `index` among the starred repos that exist; the others stay at the end. */
export function moveTo(pins: string[], exists: (n: string) => boolean, name: string, index: number): string[] {
  const live = pins.filter(exists);
  const stale = pins.filter((n) => !exists(n));
  const i = live.indexOf(name);
  if (i < 0) return pins;
  const j = Math.max(0, Math.min(index, live.length - 1));
  if (i === j) return pins;
  live.splice(i, 1);
  live.splice(j, 0, name);
  return [...live, ...stale];
}

/**
 * Where does the dragged row (currently at index `cur`) belong when the finger is at height `y`?
 * `mids` are the vertical centres of all rows in their current order (the dragged row's own entry is never read).
 */
export function dragTarget(mids: number[], cur: number, y: number): number {
  let to = cur;
  if (cur > 0 && y < mids[cur - 1]!) {
    while (to > 0 && y < mids[to - 1]!) to--;
  } else if (cur < mids.length - 1 && y > mids[cur + 1]!) {
    while (to < mids.length - 1 && y > mids[to + 1]!) to++;
  }
  return to;
}
