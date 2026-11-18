/** The app name (R and P in the icon's green) followed by the app icon. Slightly larger than the text around it, but with a tight line so the header does not grow. */
const ICON_GREEN = "text-[#3ee07a]";

export function Brand({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[1.15em] font-bold leading-none ${className}`}>
      <span><span className={ICON_GREEN}>R</span>epo<span className={ICON_GREEN}>P</span>ush</span>
      <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" aria-hidden="true" draggable={false} className="h-[1.2em] w-[1.2em] rounded-[22%]" />
    </span>
  );
}
