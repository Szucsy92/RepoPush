// Értesítések a buildekről: a fejléc harang-gombja alatt jelennek meg, repónévvel és idővel.
// - Lezárult build: addig él, amíg meg nem nézted (a lista bezárásakor eltűnik), nem kerül tárolásra.
// - Futó build: repónként egy élő sor, ami a futás állapotából számolódik; a lista bezárása nem törli, a build végén
//   magától lecserélődik a lezárult build értesítésére.
import { kindOf, type Kind } from "@/StatusIcon";

export type Note = { id: number; repo: string; kind: Kind; text: string; at: number; live?: boolean };
export type RunLike = { name: string; status: string; conclusion: string | null };
export type LiveRun = RunLike & { id: number; created?: string; jobs?: { name: string; steps: { name: string; status: string }[] }[] };
export type LiveTrack = { building: boolean; runs: LiveRun[] };

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

/**
 * A most futó buildek értesítései, repónként egy sor. A repó futásai: a követett build futásai és (a megnyitott repónál)
 * a figyelő által talált futások. A leállítást kért futás már nem számít futónak. Ha a build indult, de a futás még nem
 * jelent meg a GitHubon, „várakozás” sor jelzi.
 */
export function liveNotes(tracks: Record<string, LiveTrack>, watched: { repo: string; runs: LiveRun[] }, stopped: (id: number) => boolean, now: number): Note[] {
  const repos = new Set([...Object.keys(tracks), ...(watched.runs.length ? [watched.repo] : [])]);
  const out: Note[] = [];
  let id = 0;
  repos.forEach((repo) => {
    const t = tracks[repo];
    const all = [...(t?.runs ?? []), ...(repo === watched.repo ? watched.runs : [])];
    const open = all.filter((x, i) => x.status !== "completed" && !stopped(x.id) && all.findIndex((y) => y.id === x.id) === i);
    if (!open.length && !t?.building) return;
    if (!open.length) { out.push({ id: --id, repo, kind: "queued", at: now, live: true, text: "Build indul: várakozás a GitHubra…" }); return; }
    const kind: Kind = open.some((x) => x.status === "in_progress") ? "running" : "queued";
    const step = open.flatMap((x) => (x.jobs ?? []).flatMap((j) => j.steps.filter((s) => s.status === "in_progress").map((s) => `${j.name} · ${s.name}`)))[0];
    const times = open.map((x) => (x.created ? Date.parse(x.created) : NaN)).filter((n) => !Number.isNaN(n));
    out.push({
      id: --id, repo, kind, live: true, at: times.length ? Math.min(...times) : now,
      text: `${kind === "running" ? "Build fut" : "Build sorban áll"}: ${open.map((x) => `${x.name} → ${x.status === "queued" ? "sorban áll" : x.status === "in_progress" ? "fut" : x.status}`).join(", ")}${step ? ` (${step})` : ""}`,
    });
  });
  return out;
}
