// Status indicators in the style of GitHub's own step list: a filled circle with a check (done), a ring with a spinning
// arc and a dot (running), a clock (waiting), a filled circle with a cross (failed), a dashed circle (cancelled / skipped).
// They use the colours of the selected theme.
export type Kind = "success" | "failure" | "running" | "queued" | "stopped" | "idle";

/** The indicator for a GitHub run, job or step. */
export function kindOf(status: string, conclusion: string | null): Kind {
  if (status !== "completed") return status === "in_progress" ? "running" : "queued";
  if (conclusion === "success") return "success";
  if (conclusion === "skipped" || conclusion === "cancelled" || conclusion === "neutral") return "stopped";
  return "failure";
}

export function StatusIcon({ kind, className = "h-[18px] w-[18px]" }: { kind: Kind; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 ${className}`}>
      {kind === "success" && (
        <>
          <circle cx="12" cy="12" r="11" className="fill-primary" />
          <path d="M7 12.6l3.3 3.3L17 9.2" fill="none" className="stroke-primary-foreground" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {kind === "failure" && (
        <>
          <circle cx="12" cy="12" r="11" className="fill-destructive" />
          <path d="M8.6 8.6l6.8 6.8M15.4 8.6l-6.8 6.8" fill="none" className="stroke-destructive-foreground" strokeWidth="2.4" strokeLinecap="round" />
        </>
      )}
      {kind === "running" && (
        <>
          <circle cx="12" cy="12" r="9" fill="none" className="stroke-primary/30" strokeWidth="3" />
          <g className="animate-spin motion-reduce:animate-none" style={{ transformOrigin: "12px 12px" }}>
            <path d="M12 3a9 9 0 0 1 9 9" fill="none" className="stroke-primary" strokeWidth="3" strokeLinecap="round" />
          </g>
          <circle cx="12" cy="12" r="4" className="fill-primary" />
        </>
      )}
      {kind === "queued" && (
        <>
          <circle cx="12" cy="12" r="9.5" fill="none" className="stroke-primary" strokeWidth="2" />
          <path d="M12 7v5.2l3.2 2" fill="none" className="stroke-primary" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {kind === "stopped" && (
        <>
          <circle cx="12" cy="12" r="9.5" fill="none" className="stroke-muted-foreground" strokeWidth="2" />
          <path d="M8 12h8" fill="none" className="stroke-muted-foreground" strokeWidth="2" strokeLinecap="round" />
        </>
      )}
      {kind === "idle" && <circle cx="12" cy="12" r="7" fill="none" className="stroke-muted-foreground/60" strokeWidth="2" />}
    </svg>
  );
}
