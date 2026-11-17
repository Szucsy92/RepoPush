// Token storage. A remembered token lives only as the PIN-encrypted vault (src/lib/lock.ts);
// without "remember" it stays in sessionStorage as plain text and is gone when the app is closed.
import { clearLock, hasVault } from "@/lib/lock";

const KEY = "repopush.gh_token";

/** The session-only (not remembered) token. */
export function loadToken(): string | null {
  return sessionStorage.getItem(KEY);
}
/** Plain-text token left in localStorage by an older version: it must be moved under a PIN. Dropped if a vault already exists. */
export function loadLegacyToken(): string | null {
  const t = localStorage.getItem(KEY);
  if (t && hasVault()) { localStorage.removeItem(KEY); return null; }
  return t;
}
export function dropPlainToken() {
  localStorage.removeItem(KEY);
}
/** Not remembered → sessionStorage. Remembered tokens are stored by the PIN setup (sealToken), never as plain text. */
export function saveToken(t: string, remember: boolean) {
  clearToken();
  if (!remember) sessionStorage.setItem(KEY, t);
}
export function clearToken() {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
  clearLock();
}
