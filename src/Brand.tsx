/** The app name (R and P in the icon's green) followed by the icon's mark only, without the icon's dark tile. Large, but with a tight line so the header keeps its height. */
const GREEN = "#3ee07a";

function Mark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="130 118 256 276" aria-hidden="true" className={className}>
      <path d="M170 124L296 234L304 246L306 260L304 268L294 278L170 388L138 350L242 258L136 162Z" fill={GREEN} stroke={GREEN} strokeWidth="2" strokeLinejoin="round" />
      <rect x="296" y="337" width="83" height="52" fill={GREEN} />
    </svg>
  );
}

export function Brand({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[1.45em] font-bold leading-none ${className}`}>
      <span><span className="text-[#3ee07a]">R</span>epo<span className="text-[#3ee07a]">P</span>ush</span>
      <Mark className="h-[0.95em] w-[0.88em]" />
    </span>
  );
}
