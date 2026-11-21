// Colour themes (easter egg): double-tap the RepoPush brand to step through them. The page follows through the
// CSS variables of [data-theme] in styles.css; the launcher icon of the Android app follows through the native AppIcon plugin.
import { registerPlugin } from "@capacitor/core";
import { isNative } from "@/lib/native";
import { tap } from "@/lib/haptics";

export const THEMES = ["default", "coral", "sky", "sun", "violet"] as const;
export type ThemeId = (typeof THEMES)[number];

const KEY = "repopush.theme";
const ICON = "repopush.icon"; // the launcher icon that was last switched to
const AppIcon = registerPlugin<{ set(o: { name: ThemeId }): Promise<void> }>("AppIcon");

export const nextTheme = (t: ThemeId): ThemeId => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]!;

export function readTheme(): ThemeId {
  try {
    const v = localStorage.getItem(KEY) ?? "";
    return (THEMES as readonly string[]).includes(v) ? (v as ThemeId) : "default";
  } catch { return "default"; }
}

function setFavicon(color: string, isDefault: boolean) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  link.dataset.orig ??= link.getAttribute("href") ?? "";
  if (isDefault) { link.setAttribute("href", link.dataset.orig); return; }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='130 118 256 276'><path d='M170 124L296 234L304 246L306 260L304 268L294 278L170 388L138 350L242 258L136 162Z' fill='${color}' stroke='${color}' stroke-width='2' stroke-linejoin='round'/><rect x='296' y='337' width='83' height='52' fill='${color}'/></svg>`;
  link.setAttribute("href", `data:image/svg+xml,${encodeURIComponent(svg)}`);
}

function applyTheme(t: ThemeId) {
  const root = document.documentElement;
  if (t === "default") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  setFavicon(getComputedStyle(root).getPropertyValue("--brand").trim() || "#3ee07a", t === "default");
}

/** Android: switch the launcher icon to the current theme. The OS may restart the app when its launcher entry changes,
 *  so this runs when the app goes to the background; the marker is written first so a restart can never loop. */
function syncAppIcon() {
  if (!isNative()) return;
  const want = readTheme();
  let have: string | null = null;
  try { have = localStorage.getItem(ICON); } catch { /* ignore */ }
  if ((have ?? "default") === want) return;
  try { localStorage.setItem(ICON, want); } catch { /* ignore */ }
  AppIcon.set({ name: want }).catch(() => { try { localStorage.setItem(ICON, have ?? "default"); } catch { /* ignore */ } });
}

export function cycleTheme() {
  const t = nextTheme(readTheme());
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  applyTheme(t);
  tap("medium");
}

export function installTheme() {
  applyTheme(readTheme());
  if (!isNative()) return;
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") syncAppIcon(); });
  window.addEventListener("pagehide", syncAppIcon);
  setTimeout(syncAppIcon, 3000); // a change that could not be applied before the app was closed
}
