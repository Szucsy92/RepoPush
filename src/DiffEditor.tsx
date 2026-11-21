import { useMemo, useRef } from "react";
import { classifyDiff, type DiffKind } from "@/lib/diffview";

const COLOR: Record<DiffKind, string> = {
  add: "bg-ok-soft text-ok",
  del: "bg-destructive/10 text-destructive",
  hunk: "text-sky-400",
  file: "text-yellow-300/80",
  meta: "text-muted-foreground",
  ctx: "text-foreground/80",
  text: "text-foreground",
};

/**
 * An editable diff with syntax colours: a coloured copy of the text sits behind a transparent textarea that
 * has exactly the same font, padding and wrapping, and follows its scroll position.
 */
export function DiffEditor({ value, onChange, padBottom }: { value: string; onChange: (v: string) => void; padBottom?: boolean }) {
  const layer = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => classifyDiff(value), [value]);
  const metrics = `font-mono text-xs leading-4 whitespace-pre-wrap break-all p-3 ${padBottom ? "pb-14" : ""}`;
  return (
    <div className="relative min-w-0 flex-1">
      <div ref={layer} aria-hidden="true" className={`pointer-events-none absolute inset-0 overflow-hidden ${metrics}`}>
        {lines.map((l, i) => <div key={i} className={`-mx-3 px-3 ${COLOR[l.kind]}`}>{l.text || "\u200b"}</div>)}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => { if (layer.current) { layer.current.scrollTop = e.currentTarget.scrollTop; layer.current.scrollLeft = e.currentTarget.scrollLeft; } }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Diff / patch"
        style={{ caretColor: "var(--foreground)" }}
        className={`absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent text-transparent outline-none [scrollbar-width:none] ${metrics}`}
      />
    </div>
  );
}
