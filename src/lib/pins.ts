// Pinned repos: the picker lists them first, top to bottom in the order they were pinned (and can be reordered).
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

/** Moves a pinned repo one step up (-1) or down (1) among the pins whose repo exists; the others stay at the end. */
export function movePin(pins: string[], exists: (n: string) => boolean, name: string, d: -1 | 1): string[] {
  const live = pins.filter(exists);
  const stale = pins.filter((n) => !exists(n));
  const i = live.indexOf(name);
  const j = i + d;
  if (i < 0 || j < 0 || j >= live.length) return pins;
  [live[i], live[j]] = [live[j]!, live[i]!];
  return [...live, ...stale];
}
