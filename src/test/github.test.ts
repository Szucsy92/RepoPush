import { describe, expect, it, vi } from "vitest";
import { GitHub, gitBlobSha, planZip } from "@/lib/github";
import { saveToken, loadToken, clearToken } from "@/lib/token";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "x-ratelimit-limit": "5000", "x-ratelimit-remaining": "4999" } });

describe("GitHub client", () => {
  it("sends the token only to api.github.com with the required headers", async () => {
    const f = vi.fn(async () => ok({ login: "a", avatar_url: "x" }));
    await new GitHub("tok", f as any).getMe();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/user");
    const h = init.headers as Record<string, string>;
    expect(h["Authorization"]).toBe("Bearer tok");
    expect(h["Accept"]).toBe("application/vnd.github+json");
    expect(h["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("refuses to call any other host", async () => {
    const f = vi.fn();
    await expect(new GitHub("tok", f as any).req("https://evil.example/x")).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });

  it("explains an expired token in Hungarian", async () => {
    const f = async () => new Response('{"message":"Bad credentials"}', { status: 401 });
    await expect(new GitHub("t", f as any).getMe()).rejects.toThrow(/lejárt/);
  });

  it("reports rate limit exhaustion", async () => {
    const f = async () => new Response('{"message":"API rate limit exceeded"}', { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1" } });
    await expect(new GitHub("t", f as any).getMe()).rejects.toThrow(/korlát/);
  });
});

describe("change plan", () => {
  it("counts added, modified, unchanged and (replace only) deleted files", async () => {
    const same = btoa("hello\n");
    const remote = { "a.txt": await gitBlobSha(same), "b.txt": "0".repeat(40), "old.txt": "1".repeat(40) };
    const files = [{ path: "a.txt", base64: same }, { path: "b.txt", base64: btoa("x") }, { path: "new.txt", base64: btoa("n") }];
    const p = await planZip(files, remote, "replace");
    expect(p).toEqual({ added: ["new.txt"], modified: ["b.txt"], deleted: ["old.txt"], unchanged: 1 });
    expect((await planZip(files, remote, "merge")).deleted).toEqual([]);
  });

  it("computes real git blob shas", async () => {
    expect(await gitBlobSha(btoa("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });
});

describe("token storage", () => {
  it("uses sessionStorage only when not remembered", () => {
    saveToken("s", false);
    expect(localStorage.length).toBe(0);
    expect(loadToken()).toBe("s");
    saveToken("l", true);
    expect(sessionStorage.length).toBe(0);
    clearToken();
    expect(loadToken()).toBeNull();
  });
});
