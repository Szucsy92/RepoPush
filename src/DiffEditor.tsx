import { useMemo, useRef, type MouseEvent } from "react";
import { classifyDiff, lineSelection, type DiffKind } from "@/lib/diffview";

const COLOR: Record<DiffKind, string> = {
  add: "bg-ok-soft text-ok",
  del: "bg-destructive/10 text-destructive",
  hunk: "text-sky-400",
  file: "text-yellow-300/80",
  meta: "text-muted-foreground",
  ctx: "text-foreground/80",
  text: "text-foreground",
};

const GUTTER_PX = 44; // width of the line-number column (the text starts at 48px)

/**
 * An editable diff with syntax colours and line numbers: a coloured copy of the text sits behind a transparent
 * textarea that has exactly the same font, padding and wrapping, and follows its scroll position. The numbers are part
 * of the coloured copy (so a wrapped line only shows its number once); tapping a number selects that line, and tapping a
 * second number extends the selection, which makes deleting, cutting or replacing whole lines easy.
 */
export function DiffEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const layer = useRef<HTMLDivElement>(null);
  const picked = useRef<{ line: number; start: number; end: number } | null>(null);
  const lines = useMemo(() => classifyDiff(value), [value]);
  const metrics = "font-mono text-xs leading-5 whitespace-pre-wrap break-all pl-12 pr-3 pt-3 pb-14";

  function onGutterTap(e: MouseEvent<HTMLTextAreaElement>) {
    const ta = e.currentTarget;
    const box = ta.getBoundingClientRect();
    if (e.clientX - box.left > GUTTER_PX || !layer.current) return; // a normal tap: just edit
    // Which line is at this height? The coloured copy knows (it wraps exactly like the textarea and scrolls with it).
    const y = e.clientY - box.top + ta.scrollTop;
    const rows = Array.from(layer.current.children) as HTMLElement[];
    let line = rows.findIndex((r) => y >= r.offsetTop && y < r.offsetTop + r.offsetHeight);
    if (line < 0) line = y < (rows[0]?.offsetTop ?? 0) ? 0 : rows.length - 1;
    const prev = picked.current;
    const extend = !!prev && ta.selectionStart === prev.start && ta.selectionEnd === prev.end; // the earlier pick is still selected
    const anchor = extend ? prev!.line : line;
    const [start, end] = lineSelection(ta.value, anchor, line);
    picked.current = { line: anchor, start, end };
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(start, end);
  }

  return (
    <div className="relative min-w-0 flex-1">
      <div ref={layer} aria-hidden="true" className={`pointer-events-none absolute inset-0 overflow-hidden ${metrics}`}>
        {lines.map((l, i) => (
          <div key={i} className={`relative -ml-12 -mr-3 pl-12 pr-3 ${COLOR[l.kind]}`}>
            <span className="absolute left-0 top-0 w-10 select-none pr-2 text-right text-[10px] opacity-50">{i + 1}</span>
            {l.text || "\u200b"}
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-border/60" style={{ left: GUTTER_PX }} />
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={onGutterTap}
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
