import JSZip from "jszip";
import { parsePatch, applyPatch } from "diff";
import { alreadyApplied } from "@/lib/patch-state";

export type LocalFile = { path: string; base64: string };

export async function readZip(file: File): Promise<LocalFile[]> {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((e) => !e.dir);
  let paths = entries.map((e) => e.name.replace(/\\/g, "/"));
  // Strip a single common root folder (e.g. "repo-main/")
  const roots = new Set(paths.map((p) => (p.includes("/") ? p.split("/")[0]! : "")));
  const strip = roots.size === 1 && !roots.has("") ? [...roots][0]!.length + 1 : 0;
  const out: LocalFile[] = [];
  for (let k = 0; k < entries.length; k++) {
    const p = paths[k]!.slice(strip);
    if (!p || p.startsWith(".git/") || p.startsWith("__MACOSX/") || p.endsWith(".DS_Store")) continue;
    out.push({ path: p, base64: await entries[k]!.async("base64") });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const clean = (n?: string) => (!n || n === "/dev/null" ? null : n.replace(/^[ab]\//, "").split("\t")[0]!.trim());

export type PatchTarget = { oldPath: string | null; newPath: string | null; hunks: number };

export function patchTargets(text: string): PatchTarget[] {
  return parsePatch(text)
    .filter((p) => p.hunks.length || p.oldFileName || p.newFileName)
    .map((p) => ({ oldPath: clean(p.oldFileName), newPath: clean(p.newFileName), hunks: p.hunks.length }));
}

type FilePatch = ReturnType<typeof parsePatch>[number];

/** Which hunks (1-based) do not match the file on their own: tells the user where a diff and the repo part ways. */
function failedHunks(src: string, p: FilePatch): number[] {
  return p.hunks.flatMap((h, i) => (applyPatch(src, { ...p, hunks: [h] }, { fuzzFactor: 3 }) === false ? [i + 1] : []));
}

export function applyPatchText(text: string, sources: Record<string, string | null>) {
  const ops: { path: string; content?: string; delete?: boolean }[] = [];
  const errors: string[] = [];
  const skipped: string[] = []; // files whose changes are already in the repo
  for (const p of parsePatch(text)) {
    const oldP = clean(p.oldFileName);
    const newP = clean(p.newFileName);
    if (!oldP && !newP) continue;
    if (!newP) {
      ops.push({ path: oldP!, delete: true });
      continue;
    }
    const src = oldP ? sources[oldP] ?? "" : "";
    let res: string | false = applyPatch(src, p);
    if (res === false) {
      // Before any fuzzy matching: a diff that is already in the file is not applied a second time.
      if (oldP && alreadyApplied(src, p.hunks)) { skipped.push(newP); continue; }
      res = applyPatch(src, p, { fuzzFactor: 3 });
    }
    if (res === false) {
      const bad = failedHunks(src, p);
      errors.push(
        `Nem illeszthető: ${newP}` +
          (bad.length ? ` (a(z) ${bad.join(", ")}. blokk nem egyezik a repó jelenlegi tartalmával: a diff egy másik változatra készült, vagy egy korábbi diff még nincs alkalmazva)` : " (a blokkok együtt nem illeszthetők)"),
      );
      continue;
    }
    if (oldP === newP && res === src) { skipped.push(newP); continue; } // nothing would change
    ops.push({ path: newP, content: res });
    if (oldP && oldP !== newP) ops.push({ path: oldP, delete: true });
  }
  return { ops, errors, skipped };
}
