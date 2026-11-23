// How often the app checks GitHub for the state of the actions: fast right after a repo is opened (or a build is
// started), then every 5 s while something runs, otherwise every 8 s. The point is to see a change as soon as possible.
export const BURST_MS = 5000;

export function pollDelay(o: { sinceOpenMs: number; anyOpen: boolean }): number {
  if (o.sinceOpenMs < BURST_MS) return 1000;
  return o.anyOpen ? 5000 : 8000;
}

/** After failed checks: back off a little (nothing is shown about it, the next successful check just takes over). */
export const errorDelay = (errs: number): number => (errs > 2 ? 30000 : 15000);
