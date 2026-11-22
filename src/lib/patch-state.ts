// Is a diff already in the file? Applying it a second time must not happen: fuzzy matching would happily insert
// the additions again (an additions-only hunk still "matches" its surrounding lines).
export type HunkLike = { lines: string[] };

const stripCr = (l: string) => l.replace(/\r$/, "");

function contains(file: string[], block: string[]): boolean {
  if (!block.length) return true;
  outer: for (let i = 0; i + block.length <= file.length; i++) {
    for (let j = 0; j < block.length; j++) if (file[i + j] !== block[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * True when every hunk is already in `source`: the new version of the hunk (context + added lines) is there and,
 * if the hunk removes anything, the old version (context + removed lines) is not. Line endings do not matter.
 */
export function alreadyApplied(source: string, hunks: HunkLike[]): boolean {
  if (!hunks.length) return false;
  const file = source.split("\n").map(stripCr);
  const side = (h: HunkLike, keep: string) => h.lines.filter((l) => l.length && keep.includes(l[0]!)).map((l) => stripCr(l.slice(1)));
  return hunks.every((h) => {
    const removes = h.lines.some((l) => l[0] === "-");
    const now = side(h, " +");
    if (!now.length) return false;
    return contains(file, now) && (!removes || !contains(file, side(h, " -")));
  });
}
