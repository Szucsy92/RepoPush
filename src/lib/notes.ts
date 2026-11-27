// Értesítések a lezárult buildekről: a fejléc harang-gombja alatt jelennek meg, repónévvel és idővel. Csak addig élnek,
// amíg meg nem nézted őket (a lista bezárásakor eltűnnek), nem kerülnek tárolásra.
import { kindOf, type Kind } from "@/StatusIcon";

export type Note = { id: number; repo: string; kind: Kind; text: string; at: number };
export type RunLike = { name: string; status: string; conclusion: string | null };

/** Az egész build eredménye (ugyanaz a szabály, mint a napló ✔/✖/■ jelénél): bármi hibás → failure; minden sikeres vagy kihagyott → success; egyéb (leállított) → stopped. */
export function noteKind(runs: RunLike[]): Kind {
  if (runs.some((r) => kindOf(r.status, r.conclusion) === "failure")) return "failure";
  return runs.length && runs.every((r) => r.conclusion === "success" || r.conclusion === "skipped") ? "success" : "stopped";
}

export function buildNote(id: number, repo: string, runs: RunLike[], at: number): Note {
  const kind = noteKind(runs);
  const head = kind === "success" ? "Build kész" : kind === "failure" ? "Build hibával zárult" : "Build leállt";
  return { id, repo, kind, at, text: `${head}: ${runs.map((r) => `${r.name} → ${r.conclusion ?? r.status}`).join(", ")}` };
}

/** Egy sor ideje a listában (ó:p). */
export const noteTime = (at: number): string => new Date(at).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" });
