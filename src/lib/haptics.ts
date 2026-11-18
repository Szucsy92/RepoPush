// Haptic tick on every press. In the Android app it goes through the in-repo native plugin
// (native/PressHapticsPlugin.java); in a browser on a phone it falls back to navigator.vibrate.
import { registerPlugin } from "@capacitor/core";
import { isNative } from "@/lib/native";

export type HapticKind = "light" | "medium" | "heavy";
const Native = registerPlugin<{ tap(o: { kind: HapticKind }): Promise<void> }>("PressHaptics");

export function tap(kind: HapticKind = "light") {
  try {
    if (isNative()) void Native.tap({ kind }).catch(() => {});
    else navigator.vibrate?.(kind === "light" ? 8 : kind === "medium" ? 16 : 30);
  } catch { /* this device has no haptics */ }
}

const PRESSABLE = 'button, a[href], [role="button"], [role="option"], label[class*="cursor-pointer"], summary';

/** One listener for the whole app: touching anything pressable gives a short tick (data-haptic="medium" for the main actions). */
export function installPressFeedback() {
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse") return;
      const el = (e.target as Element | null)?.closest?.(PRESSABLE) as HTMLElement | null;
      if (!el || el.matches(":disabled") || el.getAttribute("aria-disabled") === "true") return;
      tap((el.dataset.haptic as HapticKind | undefined) ?? "light");
    },
    { capture: true, passive: true },
  );
}
