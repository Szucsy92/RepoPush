// Repónkénti build-követés. Minden repónak saját követett állapota van, így egy másik repóban futó (vagy várakozó)
// build nem tartja fogva a Build gombot és a naplót, és a háttérben követett repó állapota nem keveredik át a
// most megnyitottéba.
import type { Run } from "@/lib/github";

export type Track = {
  since: string; // az indítás ideje (ISO): ennél újabb futásokat követjük; üres = nincs aktív követés
  runs: Run[];
  building: boolean; // az appból indított build még tart (vagy a futás megjelenésére várunk)
  stopping: boolean; // leállítás kérve, a futás még nem zárult le
  forceReady: boolean; // ha a leállítás nem hat, kényszeríthető
  cancelWanted: boolean; // a build még nem jelent meg: amint megjelenik, leállítjuk
};
export type Tracks = Record<string, Track>;

export const emptyTrack: Track = { since: "", runs: [], building: false, stopping: false, forceReady: false, cancelWanted: false };

export const getTrack = (t: Tracks, repo: string): Track => t[repo] ?? emptyTrack;

export const patchTrack = (t: Tracks, repo: string, p: Partial<Track>): Tracks => ({ ...t, [repo]: { ...getTrack(t, repo), ...p } });

// A napló egy közös lista, de minden sor azt is tudja, melyik repóhoz tartozik ("" = általános sor, pl. a repólista hibája).
export type LogEntry = { repo: string; text: string };

/** Egy repó naplója: a saját sorai és az általános sorok, időrendben. */
export const logFor = (entries: LogEntry[], repo: string): string[] => entries.filter((e) => e.repo === repo || e.repo === "").map((e) => e.text);

/** Egy repó sorainak törlése (az általánosak maradnak). */
export const clearLog = (entries: LogEntry[], repo: string): LogEntry[] => entries.filter((e) => e.repo !== repo);
