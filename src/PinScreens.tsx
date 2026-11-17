import { useEffect, useRef, useState, type ReactNode } from "react";
import { Delete, Fingerprint } from "lucide-react";
import { PIN_LEN, MAX_FAILS, biometricEnabled, biometricSupported, enableBiometric, getUnlockMode, lockWaitMs, sealToken, setUnlockMode, tryUnlock, unlockWithBiometric, type UnlockMode } from "@/lib/lock";
import { dropPlainToken } from "@/lib/token";

function Shell({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-[100dvh] flex-col bg-background p-4 text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center space-y-4">
        <div className="font-mono text-lg font-bold"><span className="text-primary">›</span> repopush</div>
        <h1 className="text-base font-bold">{title}</h1>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {children}
      </div>
    </main>
  );
}

function PinPad({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const press = (d: string) => { if (!disabled && value.length < PIN_LEN) onChange(value + d); };
  const back = () => { if (!disabled) onChange(value.slice(0, -1)); };
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === "Backspace") back(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [value, disabled]);
  const key = "rounded-lg border border-border bg-card py-3 active:bg-secondary disabled:opacity-40";
  return (
    <div className="space-y-5">
      <div className="flex justify-center gap-3" role="img" aria-label={`${value.length} / ${PIN_LEN} számjegy`}>
        {Array.from({ length: PIN_LEN }, (_, i) => <span key={i} className={`h-3.5 w-3.5 rounded-full border ${i < value.length ? "border-primary bg-primary" : "border-border"}`} />)}
      </div>
      <div className="mx-auto grid max-w-[260px] grid-cols-3 gap-2 font-mono text-xl">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => <button key={d} type="button" disabled={disabled} onClick={() => press(d)} className={key}>{d}</button>)}
        <span />
        <button type="button" disabled={disabled} onClick={() => press("0")} className={key}>0</button>
        <button type="button" disabled={disabled} onClick={back} aria-label="Törlés" className={key}><Delete className="mx-auto h-6 w-6" /></button>
      </div>
    </div>
  );
}

/** After the token: choose a 6-digit PIN (twice), then optionally switch on biometrics. The token is stored encrypted only. */
export function PinSetup({ token, onDone, onBack }: { token: string; onDone: (token: string) => void; onBack: () => void }) {
  const [step, setStep] = useState<"set" | "confirm" | "bio">("set");
  const [first, setFirst] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const bioOk = biometricSupported();

  useEffect(() => {
    if (pin.length !== PIN_LEN) return;
    if (step === "set") { setFirst(pin); setPin(""); setErr(""); setStep("confirm"); return; }
    if (step !== "confirm") return;
    if (pin !== first) { setErr("A két PIN nem egyezik. Kezdd újra."); setPin(""); setFirst(""); setStep("set"); return; }
    setBusy(true);
    sealToken(token, pin)
      .then(() => { dropPlainToken(); if (bioOk) setStep("bio"); else onDone(token); })
      .catch((e) => { setErr(`A mentés nem sikerült: ${e?.message ?? e}`); setPin(""); setFirst(""); setStep("set"); })
      .finally(() => setBusy(false));
  }, [pin]);

  if (step === "bio") {
    return (
      <Shell title="Biometrikus azonosítás" hint="Az app megnyitásakor ujjlenyomattal vagy arccal is feloldhatod. A PIN-t ettől még jegyezd meg: ha a biometria nem működik, azt kérjük.">
        {err && <div className="rounded border border-destructive p-2 text-xs text-destructive">{err}</div>}
        <button disabled={busy} onClick={async () => { setBusy(true); const r = await enableBiometric(pin); setBusy(false); if (r.ok) onDone(token); else setErr(`A biometrikus azonosítás bekapcsolása nem sikerült: ${r.reason}`); }} className="w-full rounded-md bg-primary px-3 py-2.5 font-mono text-sm font-bold text-primary-foreground disabled:opacity-40">
          Bekapcsolás
        </button>
        <button disabled={busy} onClick={() => onDone(token)} className="w-full rounded-md border border-border px-3 py-2.5 font-mono text-sm">Most nem</button>
      </Shell>
    );
  }
  return (
    <Shell title={step === "set" ? "PIN-kód beállítása" : "PIN megerősítése"} hint={step === "set" ? "Adj meg egy 6 számjegyű PIN-t. Ez védi a tokent, az app megnyitásakor ezt kérjük." : "Írd be még egyszer ugyanazt a PIN-t."}>
      {err && <div className="rounded border border-destructive p-2 text-xs text-destructive">{err}</div>}
      <PinPad value={pin} onChange={setPin} disabled={busy} />
      <div className="text-center font-mono text-[11px] text-muted-foreground">{busy ? "Titkosítás…" : "\u00a0"}</div>
      <button onClick={onBack} className="mx-auto block text-xs text-muted-foreground underline">Vissza a tokenhez</button>
    </Shell>
  );
}

/** Shown on app start when a token is stored. Opens in the remembered mode (fingerprint or PIN); the button at the bottom switches. */
export function LockScreen({ onUnlock, onForgot }: { onUnlock: (token: string) => void; onForgot: () => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(() => lockWaitMs());
  const [mode, setMode] = useState<UnlockMode>(() => getUnlockMode());
  const [bioOn] = useState(() => biometricEnabled());
  const bioAvail = biometricSupported();
  const [enroll, setEnroll] = useState(false); // switch biometrics on with the next correct PIN
  const asked = useRef("");

  useEffect(() => {
    if (wait <= 0) return;
    const id = setInterval(() => setWait(lockWaitMs()), 500);
    return () => clearInterval(id);
  }, [wait > 0]);

  async function finish(p: string) {
    setBusy(true);
    const r = await tryUnlock(p);
    if (r.ok && enroll) { // the PIN is known now: store it behind the fingerprint
      const b = await enableBiometric(p);
      if (!b.ok) window.alert(`A biometrikus azonosítás bekapcsolása nem sikerült: ${b.reason}`);
    }
    setBusy(false);
    if (r.ok) return onUnlock(r.token);
    setPin("");
    if (r.wiped) { window.alert(`${MAX_FAILS} hibás PIN után a token törlődött erről az eszközről. Add meg újra.`); return onForgot(); }
    setWait(r.waitMs);
    setErr(`Hibás PIN (${r.fails}/${MAX_FAILS}).`);
  }
  useEffect(() => { if (pin.length === PIN_LEN) finish(pin); }, [pin]);

  async function viaBio() {
    if (busy || wait > 0) return;
    setErr("");
    const r = await unlockWithBiometric();
    if ("pin" in r) await finish(r.pin); else setErr(`A biometrikus azonosítás nem sikerült: ${r.reason}. Próbáld újra, vagy add meg a PIN-t.`);
  }
  useEffect(() => { if (mode === "bio" && asked.current !== "bio") { asked.current = "bio"; viaBio(); } }, [mode]);

  function choose(m: UnlockMode) {
    setUnlockMode(m); // remembered for the next start
    asked.current = "";
    setErr(""); setPin(""); setEnroll(false);
    setMode(m);
  }

  const sw = "w-full rounded-md border border-border px-3 py-2.5 font-mono text-sm";
  return (
    <Shell title={mode === "bio" ? "Biometrikus feloldás" : "PIN megadása"} hint={mode === "pin" && enroll ? "Add meg a PIN-t, utána bekapcsoljuk a biometrikus azonosítást." : undefined}>
      {mode === "bio" ? (
        <div className="space-y-3">
          <button onClick={viaBio} disabled={busy || wait > 0} aria-label="Biometrikus azonosítás" className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border border-border bg-card active:bg-secondary disabled:opacity-40">
            <Fingerprint className="h-12 w-12 text-primary" />
          </button>
          <div className="text-center text-xs text-muted-foreground">Érintsd meg az érzékelőt, vagy koppints az ikonra.</div>
        </div>
      ) : (
        <PinPad value={pin} onChange={setPin} disabled={busy || wait > 0} />
      )}
      <div className="min-h-4 text-center font-mono text-xs text-destructive">{wait > 0 ? `Túl sok próbálkozás. Várj ${Math.ceil(wait / 1000)} mp-et.` : err}</div>
      <div className="space-y-2">
        {mode === "bio" ? <button onClick={() => choose("pin")} className={sw}>PIN megadása</button>
          : bioOn ? <button onClick={() => choose("bio")} className={sw}>Biometrikus azonosítás</button>
          : bioAvail ? <button onClick={() => setEnroll((e) => !e)} className={`${sw} ${enroll ? "border-primary text-primary" : ""}`}>{enroll ? "✓ Biometrikus azonosítás bekapcsolása a következő PIN-nel" : "Biometrikus azonosítás bekapcsolása"}</button>
          : null}
        <button onClick={() => { if (window.confirm("Kijelentkezel, és a token törlődik erről az eszközről. Utána új tokent és új PIN-t kell megadnod.")) onForgot(); }} className="mx-auto block pt-1 text-xs text-muted-foreground underline">Elfelejtett PIN · kijelentkezés</button>
      </div>
    </Shell>
  );
}
