import { useRef, type PointerEvent } from "react";
import { cycleTheme } from "@/lib/theme";

/** The app name (R and P in the theme colour) followed by the icon's mark. Large, but with a tight line so the header keeps its height.
 *  Easter egg: a double tap on it steps through the colour themes. */
const FILL = { fill: "var(--brand)", stroke: "var(--brand)" } as const;

function Mark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="130 118 256 276" aria-hidden="true" className={className}>
      <path d="M170 124L296 234L304 246L306 260L304 268L294 278L170 388L138 350L242 258L136 162Z" style={FILL} strokeWidth="2" strokeLinejoin="round" />
      <rect x="296" y="337" width="83" height="52" style={{ fill: "var(--brand)" }} />
    </svg>
  );
}

export function Brand({ className = "" }: { className?: string }) {
  const last = useRef({ t: 0, x: 0, y: 0 });
  const onUp = (e: PointerEvent) => {
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    const near = Math.hypot(e.clientX - last.current.x, e.clientY - last.current.y) < 40;
    if (last.current.t && e.timeStamp - last.current.t < 350 && near) {
      last.current.t = 0;
      cycleTheme();
    } else {
      last.current = { t: e.timeStamp, x: e.clientX, y: e.clientY };
    }
  };
  return (
    <span onPointerUp={onUp} className={`inline-flex touch-manipulation select-none items-center gap-1.5 font-mono text-[1.45em] font-bold leading-none ${className}`}>
      <span><span className="text-[color:var(--brand)]">R</span>epo<span className="text-[color:var(--brand)]">P</span>ush</span>
      <Mark className="h-[0.95em] w-[0.88em]" />
    </span>
  );
}
