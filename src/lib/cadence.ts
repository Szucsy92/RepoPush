// How often the app checks GitHub for the state of the actions: fast right after a repo is opened (or a build is
// started), then every 8 s. The GitHub API allows 5000 requests an hour per token, and a running build is followed
// by two pollers, so a slower steady rhythm keeps a long build well below that limit.
export const BURST_MS = 5000;
export const POLL_MS = 8000;

export function pollDelay(o: { sinceOpenMs: number }): number {
  return o.sinceOpenMs < BURST_MS ? 1000 : POLL_MS;
}

/** After failed checks: back off a little (nothing is shown about it, the next successful check just takes over). */
export const errorDelay = (errs: number): number => (errs > 2 ? 30000 : 15000);
