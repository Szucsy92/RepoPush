/** The app name followed by the app icon, the same mark as the launcher icon. */
export function Brand({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono font-bold ${className}`}>
      RepoPush
      <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" aria-hidden="true" draggable={false} className="h-[1.25em] w-[1.25em] rounded-[22%]" />
    </span>
  );
}
