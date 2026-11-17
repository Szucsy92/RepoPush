// Token storage. "Remember" → localStorage, otherwise sessionStorage only.
const KEY = "repopush.gh_token";

export function loadToken(): string | null {
  return localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
}
export function saveToken(t: string, remember: boolean) {
  clearToken();
  (remember ? localStorage : sessionStorage).setItem(KEY, t);
}
export function clearToken() {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
}
