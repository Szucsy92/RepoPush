import { isNative } from "./native";

// Single service-worker registrar. Never registers in dev, inside iframes or in the APK (?sw=off also disables it).
function refused(): boolean {
  if (!import.meta.env.PROD) return true;
  if (isNative()) return true;
  if (window.self !== window.top) return true;
  if (new URLSearchParams(location.search).get("sw") === "off") return true;
  return false;
}

export function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  const url = new URL("./sw.js", document.baseURI).href;
  if (refused()) {
    navigator.serviceWorker.getRegistrations().then((rs) =>
      rs.filter((r) => r.active?.scriptURL === url || r.installing?.scriptURL === url || r.waiting?.scriptURL === url).forEach((r) => r.unregister()),
    );
    return;
  }
  window.addEventListener("load", () => navigator.serviceWorker.register(url).catch(() => {}));
}
