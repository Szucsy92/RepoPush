import { describe, expect, it } from "vitest";
import { clearLog, emptyTrack, getTrack, logFor, patchTrack, type LogEntry, type Tracks } from "@/lib/build-track";

describe("build tracking per repo", () => {
  it("a build in one repo leaves other repos idle", () => {
    const t: Tracks = patchTrack({}, "me/a", { building: true, since: "2026-01-01T00:00:00Z" });
    expect(getTrack(t, "me/a").building).toBe(true);
    expect(getTrack(t, "me/b")).toEqual(emptyTrack);
  });

  it("patching keeps the other fields and the other repos untouched", () => {
    let t: Tracks = patchTrack({}, "me/a", { building: true });
    t = patchTrack(t, "me/b", { cancelWanted: true });
    t = patchTrack(t, "me/a", { since: "2026-01-01T00:00:00Z" });
    expect(getTrack(t, "me/a")).toMatchObject({ building: true, since: "2026-01-01T00:00:00Z", cancelWanted: false });
    expect(getTrack(t, "me/b")).toMatchObject({ building: false, cancelWanted: true });
  });

  it("the log shows a repo's own lines plus the general ones", () => {
    const e: LogEntry[] = [{ repo: "", text: "g" }, { repo: "me/a", text: "a1" }, { repo: "me/b", text: "b1" }, { repo: "me/a", text: "a2" }];
    expect(logFor(e, "me/a")).toEqual(["g", "a1", "a2"]);
    expect(logFor(e, "me/b")).toEqual(["g", "b1"]);
    expect(clearLog(e, "me/a").map((x) => x.text)).toEqual(["g", "b1"]);
  });
});
