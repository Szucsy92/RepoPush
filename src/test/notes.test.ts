import { describe, expect, it } from "vitest";
import { buildNote, noteKind } from "@/lib/notes";

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
