// Geometry of the expanded diff window: from its place in the layout it grows both upward and downward.
export type Rect = { top: number; left: number; width: number; height: number };
export type Insets = { top: number; right: number; bottom: number; left: number };

/**
 * The open window spans from the top of the screen (below the status bar) to the middle of the screen
 * (landscape: nearly the full height). It never ends above where the closed window ends, so it always grows
 * downward as well as upward. Horizontally it is as wide as the layout (at most 42rem), centred.
 */
export function openRect(win: { width: number; height: number }, inset: Insets, landscape: boolean, from: Rect): Rect {
  const availW = win.width - inset.left - inset.right - 24;
  const width = Math.min(availW, 672);
  const left = inset.left + 12 + (availW - width) / 2;
  const top = Math.min(inset.top + 4, from.top);
  const bottom = Math.max(landscape ? win.height - inset.bottom - 8 : win.height / 2, from.top + from.height);
  return { top, left, width, height: Math.max(120, bottom - top) };
}

/** The status / navigation bar heights that the SystemInsets plugin put into CSS variables (0 in a browser). */
export function readInsets(): Insets {
  const cs = getComputedStyle(document.documentElement);
  const n = (k: string) => parseFloat(cs.getPropertyValue(k)) || 0;
  return { top: n("--inset-top"), right: n("--inset-right"), bottom: n("--inset-bottom"), left: n("--inset-left") };
}
