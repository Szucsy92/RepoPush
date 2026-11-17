import { useState } from "react";
import { GitHub } from "@/lib/github";
import { saveToken } from "@/lib/token";

export function TokenScreen({ onDone }: { onDone: (token: string, me: { login: string; avatar: string }) => void }) {
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [me, setMe] = useState<{ login: string; avatar: string } | null>(null);

  async function check() {
    setBusy(true); setErr(""); setMe(null);
    try {
      const u = await new GitHub(token.trim()).getMe();
      setMe(u);
    } catch (e: any) { setErr(e.message ?? String(e)); } finally { setBusy(false); }
  }

  return (
    <main className="flex min-h-[100dvh] flex-col bg-background p-4 text-foreground">
      <div className="mx-auto w-full max-w-md space-y-3">
        <div className="font-mono text-lg font-bold"><span className="text-primary">›</span> repopush</div>
        <h1 className="text-base font-bold">Token megadása</h1>
        <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
          <li>GitHubon: <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token</b>.</li>
          <li>Válaszd ki a repókat (vagy „All repositories”), és add meg a lejáratot.</li>
          <li>Repository permissions: <b>Contents</b>, <b>Actions</b>, <b>Workflows</b>: Read and write; <b>Metadata</b>: Read.</li>
          <li>Klasszikus token esetén a <b>repo</b> és <b>workflow</b> jogot pipáld be.</li>
          <li>Másold be ide. A token csak ezen az eszközön marad, és csak a GitHubnak küldjük.</li>
        </ol>
        <input
          type="password" autoComplete="off" spellCheck={false} value={token}
          onChange={(e) => { setToken(e.target.value); setMe(null); }}
          placeholder="github_pat_… vagy ghp_…" className="field w-full font-mono text-xs"
        />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Token megjegyzése ezen az eszközön
        </label>
        {err && <div className="rounded border border-destructive p-2 text-xs text-destructive">{err}</div>}
        {me ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded border border-border p-2 font-mono text-sm">
              <img src={me.avatar} alt="" className="h-8 w-8 rounded-full" /> {me.login}
            </div>
            <button onClick={() => { saveToken(token.trim(), remember); onDone(token.trim(), me); }} className="w-full rounded-md bg-primary px-3 py-2.5 font-mono text-sm font-bold text-primary-foreground">
              Mentés és tovább
            </button>
          </div>
        ) : (
          <button disabled={busy || !token.trim()} onClick={check} className="w-full rounded-md bg-primary px-3 py-2.5 font-mono text-sm font-bold text-primary-foreground disabled:opacity-40">
            {busy ? "Ellenőrzés…" : "Token ellenőrzése"}
          </button>
        )}
      </div>
    </main>
  );
}
