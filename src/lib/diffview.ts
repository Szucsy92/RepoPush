// Line kinds for colouring a unified diff: + green, - red, @@ blue, file headers yellow.
export type DiffKind = "add" | "del" | "hunk" | "file" | "meta" | "ctx" | "text";
export type DiffLine = { kind: DiffKind; text: string };

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const FILE = /^(diff --git |diff --cc |index [0-9a-f]+\.\.|new file mode|deleted file mode|old mode|new mode|similarity index|dissimilarity index|rename from|rename to|copy from|copy to|Binary files |GIT binary patch|literal \d+|delta \d+|--- |\+\+\+ )/;

/**
 * Inside a hunk the @@ line counts say exactly which lines belong to it, so a deleted "-- comment" line
 * (shown as "--- comment") is not mistaken for a file header. Wrong counts are tolerated: a real header
 * (diff --git, or --- followed by +++) always ends the hunk.
 */
export function classifyDiff(text: string): DiffLine[] {
  const lines = text.split("\n");
  let oldLeft = 0;
  let newLeft = 0;
  return lines.map((line, i): DiffLine => {
    if (oldLeft > 0 || newLeft > 0) {
      const header = line.startsWith("diff --git ") || (line.startsWith("--- ") && (lines[i + 1] ?? "").startsWith("+++ "));
      if (!header) {
        const c = line[0];
        if (c === "+") { newLeft--; return { kind: "add", text: line }; }
        if (c === "-") { oldLeft--; return { kind: "del", text: line }; }
        if (c === " " || line === "") { oldLeft--; newLeft--; return { kind: "ctx", text: line }; }
        if (c === "\\") return { kind: "meta", text: line };
      }
      oldLeft = 0;
      newLeft = 0;
    }
    const m = HUNK.exec(line);
    if (m) {
      oldLeft = m[2] === undefined ? 1 : +m[2];
      newLeft = m[4] === undefined ? 1 : +m[4];
      return { kind: "hunk", text: line };
    }
    return { kind: FILE.test(line) ? "file" : "text", text: line };
  });
}

/**
 * The character range of lines a..b (0-based, in any order), including the line break after the last one,
 * so cutting or deleting the selection removes the whole lines. Offsets refer to the text exactly as given
 * (pass the textarea's own value, which always uses \n).
 */
export function lineSelection(text: string, a: number, b: number = a): [number, number] {
  const lines = text.split("\n");
  const first = Math.max(0, Math.min(a, b, lines.length - 1));
  const last = Math.min(lines.length - 1, Math.max(a, b));
  let start = 0;
  for (let i = 0; i < first; i++) start += lines[i]!.length + 1;
  let end = start;
  for (let i = first; i <= last; i++) end += lines[i]!.length + 1;
  return [start, Math.min(end, text.length)];
}
