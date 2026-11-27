import { describe, expect, it } from "vitest";
import { buildFromTag, needsUpdate, pickRelease, validApkUrl } from "@/lib/ota";

const apk = "https://github.com/me/RepoPush/releases/download/v1.0.42/RepoPush-1.0.42-20261127-1230.apk";

describe("in-app update", () => {
  it("reads the build number from the release tag", () => {
    expect(buildFromTag("v1.0.42")).toBe(42);
    expect(buildFromTag("v1.0.7")).toBe(7);
    expect(buildFromTag("latest")).toBeNull();
  });

  it("offers an update only for a newer build", () => {
    expect(needsUpdate(41, 42)).toBe(true);
    expect(needsUpdate(42, 42)).toBe(false);
    expect(needsUpdate(43, 42)).toBe(false);
    expect(needsUpdate(NaN, 42)).toBe(false);
  });

  it("accepts only github.com release downloads of an .apk", () => {
    expect(validApkUrl(apk)).toBe(true);
    expect(validApkUrl("http://github.com/me/r/releases/download/v1/a.apk")).toBe(false);
    expect(validApkUrl("https://evil.example/me/r/releases/download/v1/a.apk")).toBe(false);
    expect(validApkUrl("https://github.com/me/r/archive/main.zip")).toBe(false);
    expect(validApkUrl("https://github.com/me/r/releases/download/v1/a.zip")).toBe(false);
    expect(validApkUrl(42)).toBe(false);
  });

  it("picks the APK and the build of a release", () => {
    expect(pickRelease({ tag_name: "v1.0.42", assets: [{ name: "notes.txt", browser_download_url: "https://github.com/x" }, { name: "RepoPush-1.0.42-20261127-1230.apk", browser_download_url: apk }] }))
      .toEqual({ versionCode: 42, version: "v1.0.42", apk });
    expect(pickRelease({ tag_name: "v1.0.42", assets: [] })).toBeNull();
    expect(pickRelease({ tag_name: "nightly", assets: [{ name: "a.apk", browser_download_url: apk }] })).toBeNull();
    expect(pickRelease({ tag_name: "v1.0.42", assets: [{ name: "a.apk", browser_download_url: "https://evil.example/a.apk" }] })).toBeNull();
  });
});
