// In-app (OTA) update, Android APK only: the app looks at the latest release of its own repository, compares the
// build number at the end of the release tag (v1.0.<run number>) with the installed versionCode (the same run
// number) and, if newer, offers the update. The native plugin (native/AppUpdatePlugin.java) downloads the APK
// from github.com/.../releases/download/... itself and starts the system installer. The web side only ever talks
// to api.github.com (release lookup), so the CSP stays as it is.
import { registerPlugin } from "@capacitor/core";
import { isNative } from "@/lib/native";
import type { GitHub } from "@/lib/github";

export type AppRelease = { versionCode: number; version: string; apk: string };
export type UpdateState = "installing" | "needsPermission" | "failed";

const REPO_RE = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;

/** The repository the releases come from: written into the build by the workflow (VITE_RELEASE_REPOSITORY). */
export function releaseRepository(): string | null {
  const v = import.meta.env["VITE_RELEASE_REPOSITORY"] as string | undefined;
  return v && REPO_RE.test(v) ? v : null;
}

export const needsUpdate = (installed: number, latest: number): boolean =>
  Number.isInteger(installed) && Number.isInteger(latest) && latest > installed;

/** Only https://github.com/<user>/<repo>/releases/download/<tag>/<file>.apk is accepted (the native side checks it too). */
export function validApkUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && /^\/[\w.-]+\/[\w.-]+\/releases\/download\/[^/]+\/[\w.-]+\.apk$/.test(url.pathname);
  } catch {
    return false;
  }
}

/** The release tag ends with the run number (v1.0.42 → 42): that is the Android versionCode. */
export function buildFromTag(tag: string): number | null {
  const m = /(\d+)$/.exec(tag);
  return m ? Number(m[1]) : null;
}

type ReleaseData = { tag_name?: string; assets?: { name: string; browser_download_url: string }[] };

/** The downloadable APK and its build number; null if there is no APK or the tag has no number. */
export function pickRelease(data: ReleaseData): AppRelease | null {
  const tag = data.tag_name ?? "";
  const build = buildFromTag(tag);
  const apk = data.assets?.find((a) => a.name.endsWith(".apk") && validApkUrl(a.browser_download_url));
  if (build === null || !apk) return null;
  return { versionCode: build, version: tag, apk: apk.browser_download_url };
}

/** The latest release of `repo` (throws when GitHub cannot be reached, so a manual check can say so). */
export async function latestAppRelease(gh: GitHub, repo: string): Promise<AppRelease | null> {
  if (!REPO_RE.test(repo)) return null;
  return pickRelease(await gh.req<ReleaseData>(`repos/${repo}/releases/latest`));
}

type AppUpdatePlugin = {
  downloadAndInstall(o: { url: string }): Promise<{ state: UpdateState }>;
  versionCode(): Promise<{ versionCode: number }>;
  addListener(event: "updateProgress", cb: (d: { percent: number }) => void): Promise<{ remove(): Promise<void> }>;
};
const Native = registerPlugin<AppUpdatePlugin>("AppUpdate");

/**
 * Downloads the new APK inside the app, then opens the system installer.
 * installing = the installer opened; needsPermission = the "install unknown apps" page opened; failed = did not work.
 */
export async function downloadAndInstall(url: string, onProgress: (percent: number) => void): Promise<UpdateState> {
  if (!isNative() || !validApkUrl(url)) return "failed";
  let listener: { remove(): Promise<void> } | null = null;
  try {
    listener = await Native.addListener("updateProgress", ({ percent }) => onProgress(percent));
    return (await Native.downloadAndInstall({ url })).state;
  } catch {
    return "failed";
  } finally {
    await listener?.remove().catch(() => {});
  }
}

/** The installed APK's real versionCode (from the native package info); the build-time value is only a fallback. */
export async function installedVersionCode(): Promise<number> {
  const built = Number(import.meta.env["VITE_APP_VERSION_CODE"] ?? 0);
  if (!isNative()) return built;
  try {
    const { versionCode } = await Native.versionCode();
    return Number.isInteger(versionCode) && versionCode > 0 ? versionCode : built;
  } catch {
    return built;
  }
}
