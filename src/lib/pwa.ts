// Single service-worker registrar. Never registers in dev, iframes or Lovable previews.
const PREVIEW_LABEL = /^(?:id-preview|preview)(?:-[a-z0-9]+)?--.+$/;

function refused(): boolean {
  if (!import.meta.env.PROD) return true;
  if (window.self !== window.top) return true;
  if (new URLSearchParams(location.search).get("sw") === "off") return true;
  const h = location.hostname.toLowerCase();
  const label = h.split(".")[0] ?? "";
  if (/\.(lovable\.app|gpt-eng\.com|gptengineer\.run)$/.test(h) && (PREVIEW_LABEL.test(label) || /^project--.+-dev$/.test(label))) return true;
  if (/(^|\.)lovableproject(-dev)?\.com$/.test(h) || /(^|\.)beta\.lovable\.dev$/.test(h)) return true;
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
