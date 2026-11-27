import type { AppRelease } from "@/lib/ota";

export type UpdateStatus = "idle" | "downloading" | "permission" | "failed";

/** The "new version" pop-up of the in-app update: later / download, with a progress bar while the APK comes down. */
export function UpdateDialog({ release, status, percent, onLater, onInstall }: {
  release: AppRelease; status: UpdateStatus; percent: number | null; onLater: () => void; onInstall: () => void;
}) {
  const busy = status === "downloading";
  return (
    <div role="dialog" aria-modal="true" aria-label="Új frissítés elérhető" className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm space-y-3 rounded-2xl border border-border bg-popover p-4 shadow-2xl">
        <h2 className="font-bold">Új frissítés elérhető</h2>
        <div className="font-mono text-xs text-primary">RepoPush {release.version}</div>
        <p className="text-xs text-muted-foreground">
          {status === "permission" ? "Engedélyezd az ismeretlen forrásból telepítést a RepoPush számára, majd koppints újra a Telepítés gombra."
            : status === "failed" ? "Az appon belüli letöltés nem sikerült. Letöltheted a böngészőben is, és onnan telepítheted."
            : "A letöltés az appban történik, utána a rendszer telepítője indul. Az adataid megmaradnak."}
        </p>
        {busy && (
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-border/50">
              <div className={`h-full rounded-full bg-primary transition-all ${percent === null ? "w-1/3 animate-pulse" : ""}`} style={percent === null ? undefined : { width: `${percent}%` }} />
            </div>
            <div className="font-mono text-[11px] text-muted-foreground">Letöltés…{percent !== null ? ` ${percent}%` : ""}</div>
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={onLater} disabled={busy} className="flex-1 rounded-xl border border-border px-3 py-2 text-sm disabled:opacity-50">Később</button>
          {status === "failed" ? (
            <a href={release.apk} target="_blank" rel="noopener noreferrer" data-haptic="medium" className="flex-1 rounded-xl bg-primary px-3 py-2 text-center text-sm font-bold text-primary-foreground">Letöltés böngészőben</a>
          ) : (
            <button onClick={onInstall} disabled={busy} data-haptic="medium" className="flex-1 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-60">{busy ? "Letöltés…" : "Telepítés"}</button>
          )}
        </div>
      </div>
    </div>
  );
}
