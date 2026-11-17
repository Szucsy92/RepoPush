// PIN lock. A remembered GitHub token exists on the device only as an AES-GCM vault whose key is
// derived from a 6-digit PIN (PBKDF2). Biometrics (Android app only) never replace the PIN: they just
// hand it back from the Keystore-backed secure store, so the PIN stays the one secret that opens the vault.
import { isNative } from "@/lib/native";

export const PIN_LEN = 6;
export const MAX_FAILS = 10; // this many wrong PINs in a row wipe the vault (the token has to be entered again)
const FREE_TRIES = 5; // after this many wrong PINs every further one adds a growing wait
const VAULT = "repopush.vault";
const FAILS = "repopush.pin_fails";
const BIO = "repopush.bio";
const MODE = "repopush.unlock_mode"; // remembered choice on the lock screen: "bio" | "pin"
const BIO_SERVER = "io.github.szucsy92.repopush";
const ITER = 600_000;

export const validPin = (p: string) => /^\d{6}$/.test(p);

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(pin: string, salt: Uint8Array, iter: number) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export const hasVault = (): boolean => !!localStorage.getItem(VAULT);

export async function sealToken(token: string, pin: string): Promise<void> {
  if (!validPin(pin)) throw new Error("A PIN pontosan 6 számjegy legyen.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt, ITER);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token)));
  localStorage.setItem(VAULT, JSON.stringify({ v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
  localStorage.removeItem(FAILS);
}

async function openToken(pin: string): Promise<string | null> {
  try {
    const v = JSON.parse(localStorage.getItem(VAULT) ?? "");
    const key = await deriveKey(pin, unb64(v.salt), v.iter);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(v.iv) }, key, unb64(v.ct)));
  } catch { return null; } // wrong PIN (GCM tag mismatch) or damaged vault
}

function readFails(): { n: number; until: number } {
  try { const f = JSON.parse(localStorage.getItem(FAILS) ?? ""); return { n: +f.n || 0, until: +f.until || 0 }; } catch { return { n: 0, until: 0 }; }
}
/** Milliseconds left of the wait after too many wrong PINs (0 = may try). */
export const lockWaitMs = (): number => Math.max(0, readFails().until - Date.now());

export type Unlock = { ok: true; token: string } | { ok: false; fails: number; waitMs: number; wiped: boolean };

/** Checks the PIN, counts wrong tries, makes the user wait and finally wipes the vault. */
export async function tryUnlock(pin: string): Promise<Unlock> {
  const f = readFails();
  const now = Date.now();
  if (f.until > now) return { ok: false, fails: f.n, waitMs: f.until - now, wiped: false };
  const token = await openToken(pin);
  if (token !== null) { localStorage.removeItem(FAILS); return { ok: true, token }; }
  const n = f.n + 1;
  if (n >= MAX_FAILS) { clearLock(); return { ok: false, fails: n, waitMs: 0, wiped: true }; }
  const waitMs = n >= FREE_TRIES ? 30_000 * (n - FREE_TRIES + 1) : 0;
  localStorage.setItem(FAILS, JSON.stringify({ n, until: now + waitMs }));
  return { ok: false, fails: n, waitMs, wiped: false };
}

// --- Biometrics (Capacitor app only; loaded lazily so the web build never touches the plugin) ---
const bio = async () => (await import("capacitor-native-biometric")).NativeBiometric;

export const biometricEnabled = (): boolean => isNative() && localStorage.getItem(BIO) === "1";

export type UnlockMode = "bio" | "pin";
/** The remembered way to unlock (biometrics first once they are switched on, until the user picks the PIN). */
export function getUnlockMode(): UnlockMode {
  if (!biometricEnabled()) return "pin";
  return localStorage.getItem(MODE) === "pin" ? "pin" : "bio";
}
export const setUnlockMode = (m: UnlockMode) => localStorage.setItem(MODE, m);

/** The Android app is the only place biometrics exist. The device's own answer comes when it is used, with the real error text. */
export const biometricSupported = (): boolean => isNative();

const errText = (e: unknown): string => {
  const x = e as { message?: string; code?: string | number } | string | undefined;
  if (typeof x === "string") return x;
  return [x?.message, x?.code].filter((v) => v !== undefined && v !== "").join(" · ") || "ismeretlen hiba";
};

// A native call that never answers must not freeze the screen that waits for it.
const BIO_TIMEOUT_MS = 45_000;
const withTimeout = <T>(p: Promise<T>, ms = BIO_TIMEOUT_MS): Promise<T> =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("időtúllépés: a rendszer nem válaszolt a biometrikus kérésre")), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });

export type BioResult = { ok: true } | { ok: false; reason: string };

export async function enableBiometric(pin: string): Promise<BioResult> {
  try {
    await withTimeout((async () => {
      const b = await bio();
      await b.verifyIdentity({ reason: "Biometrikus feloldás bekapcsolása", title: "RepoPush" });
      await b.setCredentials({ username: "pin", password: pin, server: BIO_SERVER });
    })());
    localStorage.setItem(BIO, "1");
    setUnlockMode("bio");
    return { ok: true };
  } catch (e) { return { ok: false, reason: errText(e) }; }
}

/** Asks for the fingerprint/face and returns the stored PIN, or the reason it did not work (cancelled, plugin missing…). */
export async function unlockWithBiometric(): Promise<{ pin: string } | { reason: string }> {
  try {
    return await withTimeout((async () => {
      const b = await bio();
      await b.verifyIdentity({ reason: "Feloldás", title: "RepoPush" });
      return { pin: (await b.getCredentials({ server: BIO_SERVER })).password };
    })());
  } catch (e) { return { reason: errText(e) }; }
}

/** Removes the vault, the wrong-PIN counter and the biometric secret. */
export function clearLock() {
  const hadBio = localStorage.getItem(BIO) === "1";
  [VAULT, FAILS, BIO, MODE].forEach((k) => localStorage.removeItem(k));
  if (hadBio && isNative()) bio().then((b) => b.deleteCredentials({ server: BIO_SERVER })).catch(() => {});
}
