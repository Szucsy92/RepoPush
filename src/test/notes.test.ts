import { describe, expect, it } from "vitest";
import { buildNote, liveNotes, noteKind } from "@/lib/notes";

const run = (name: string, conclusion: string | null, status = "completed") => ({ name, status, conclusion });

describe("build notifications", () => {
  it("classifies the outcome of a finished build", () => {
    expect(noteKind([run("a", "success"), run("b", "skipped")])).toBe("success");
    expect(noteKind([run("a", "success"), run("b", "failure")])).toBe("failure");
    expect(noteKind([run("a", "cancelled")])).toBe("stopped");
    expect(noteKind([])).toBe("stopped");
  });

  it("labels the note with the repo, the time and the runs", () => {
    const n = buildNote(7, "me/app", [run("CI", "success")], 1000);
    expect(n).toMatchObject({ id: 7, repo: "me/app", kind: "success", at: 1000 });
    expect(n.text).toContain("CI → success");
  });
});

describe("live build notifications", () => {
  const r = (id: number, status: string, extra = {}) => ({ id, name: "APK", status, conclusion: null, ...extra });
  const none = () => false;

  it("shows one live row per repo with a running build", () => {
    const n = liveNotes({ "me/app": { building: true, runs: [r(1, "in_progress", { jobs: [{ name: "apk", steps: [{ name: "APK építése", status: "in_progress" }] }] })] } }, { repo: "me/app", runs: [] }, none, 5);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ repo: "me/app", kind: "running", live: true });
    expect(n[0].text).toContain("APK → fut");
    expect(n[0].text).toContain("APK építése");
  });

  it("includes runs found by the watcher for the open repo, without duplicates", () => {
    const n = liveNotes({ "me/app": { building: false, runs: [r(1, "queued")] } }, { repo: "me/app", runs: [r(1, "queued"), r(2, "in_progress")] }, none, 5);
    expect(n).toHaveLength(1);
    expect(n[0].text).toContain("APK → sorban áll, APK → fut");
  });

  it("waits for the run to appear while the build is starting", () => {
    const n = liveNotes({ "me/app": { building: true, runs: [] } }, { repo: "me/app", runs: [] }, none, 5);
    expect(n[0]).toMatchObject({ kind: "queued", live: true });
  });

  it("drops runs that were asked to stop and finished builds", () => {
    expect(liveNotes({ "me/app": { building: false, runs: [r(1, "in_progress")] } }, { repo: "me/app", runs: [] }, (id) => id === 1, 5)).toEqual([]);
    expect(liveNotes({ "me/app": { building: false, runs: [r(1, "completed")] } }, { repo: "me/app", runs: [] }, none, 5)).toEqual([]);
  });
});

