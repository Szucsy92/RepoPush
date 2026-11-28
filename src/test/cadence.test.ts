import { describe, expect, it } from "vitest";
import { BURST_MS, POLL_MS, errorDelay, pollDelay } from "@/lib/cadence";

describe("polling cadence", () => {
  it("looks fast right after opening, then settles to the steady rhythm", () => {
    expect(pollDelay({ sinceOpenMs: 0 })).toBe(1000);
    expect(pollDelay({ sinceOpenMs: BURST_MS - 1 })).toBe(1000);
    expect(pollDelay({ sinceOpenMs: BURST_MS })).toBe(POLL_MS);
  });

  it("backs off after failed checks", () => {
    expect(errorDelay(1)).toBe(15000);
    expect(errorDelay(3)).toBe(30000);
  });
});
