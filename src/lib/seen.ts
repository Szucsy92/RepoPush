// Repónként megjegyzi, melyik release-t töltötted már le, hogy ugyanazt ne ajánlja újra.
const KEY = "repopush.seen_releases";

function load(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>; } catch { return {}; }
}
export function seenRelease(repo: string): string | undefined {
  return load()[repo];
}
export function markSeen(repo: string, id: string) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...load(), [repo]: id })); } catch { /* nincs tárhely: nem kritikus */ }
}
