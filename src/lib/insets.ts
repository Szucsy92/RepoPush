// The Android app draws behind the (transparent) status and navigation bars. The native SystemInsets plugin
// reports how tall those bars are, and they become CSS variables that the layout pads itself with.
import { registerPlugin } from "@capacitor/core";
import { isNative } from "@/lib/native";

type Insets = { top: number; right: number; bottom: number; left: number };
const SystemInsets = registerPlugin<{ get(): Promise<Insets> }>("SystemInsets");

async function apply() {
  try {
    const i = await SystemInsets.get();
    const s = document.documentElement.style;
    s.setProperty("--inset-top", `${i.top}px`);
    s.setProperty("--inset-right", `${i.right}px`);
    s.setProperty("--inset-bottom", `${i.bottom}px`);
    s.setProperty("--inset-left", `${i.left}px`);
  } catch { /* keep the last known values */ }
}

export function installSystemInsets() {
  if (!isNative()) return;
  void apply();
  window.addEventListener("resize", apply); // rotation, keyboard
  window.addEventListener("orientationchange", apply);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void apply(); });
  [150, 600, 1500].forEach((ms) => setTimeout(apply, ms)); // the window may get its insets a moment after the page starts
}
