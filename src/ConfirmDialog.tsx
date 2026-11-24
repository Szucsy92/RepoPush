import type { Plan } from "@/lib/github";

export function ConfirmDialog({ plan, repo, branch, mode, onOk, onCancel }: {
  plan: Plan; repo: string; branch: string; mode: string; onOk: () => void; onCancel: () => void;
}) {
  const list = (t: string, xs: string[], cls: string) => xs.length > 0 && (
    <details className="text-xs"><summary className={cls}>{t}: {xs.length}</summary>
      <div className="max-h-28 overflow-auto pl-3 font-mono text-[10px] text-muted-foreground">{xs.map((x) => <div key={x}>{x}</div>)}</div>
    </details>
  );
  const nothing = !plan.added.length && !plan.modified.length && !plan.deleted.length;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm">
      <div className="max-h-[92dvh] w-full max-w-sm space-y-2 overflow-y-auto rounded-2xl border border-border bg-popover p-4 shadow-2xl">
        <h2 className="font-bold">Biztosan végrehajtod?</h2>
        <div className="font-mono text-xs">{repo} @ <b>{branch}</b> · {mode}</div>
        {nothing ? (
          <div className="rounded-xl border border-border bg-card p-2 text-xs">Nincs tartalmi változás: mindez már így van a repóban. Üres commit készül, ami újraindítja a push-ra figyelő workflow-kat.</div>
        ) : (
          <div className="grid grid-cols-3 gap-1 text-center font-mono text-xs">
            <div className="rounded border border-border p-1"><div className="text-lg text-ok">{plan.added.length}</div>új</div>
            <div className="rounded border border-border p-1"><div className="text-lg">{plan.modified.length}</div>módosul</div>
            <div className="rounded border border-border p-1"><div className="text-lg text-destructive">{plan.deleted.length}</div>törlődik</div>
          </div>
        )}
        {plan.unchanged > 0 && <div className="text-xs text-muted-foreground">{plan.unchanged} fájl változatlan.</div>}
        {list("Új", plan.added, "text-ok")}
        {list("Módosul", plan.modified, "")}
        {list("Törlődik", plan.deleted, "text-destructive")}
        <div className="text-xs text-muted-foreground">Az ág kényszerített frissítése felülírja az ág jelenlegi állapotát.</div>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 rounded-xl border border-border px-3 py-2 text-sm">Mégse</button>
          <button onClick={onOk} data-haptic="medium" className="flex-1 rounded-xl bg-destructive px-3 py-2 text-sm font-bold text-destructive-foreground">Végrehajtás</button>
        </div>
      </div>
    </div>
  );
}
