"use client";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useProduct } from "../../../components/product-provider";
import { HttpClient } from "../../../lib/http-client";

type Status = { enabled: boolean; stepUpExpiresAt: string | null };
type Envelope<T> = { data: T };
type SetupResult = { secret: string; uri: string; expiresAt: string };

export default function SecurityPage() {
  const { user } = useProduct();
  if (!user) return <section className="kv-card screen-stack">
    <h1>Hesap güvenliği</h1>
    <p>Güvenlik ayarlarını görüntülemek için giriş yap.</p>
    <Link className="kv-button" href="/giris?returnTo=%2Fhesap%2Fguvenlik">Giriş yap</Link>
  </section>;
  // Each identity owns a separate component lifetime, including its secret, inputs and outstanding responses.
  return <SecuritySettings key={user.id} userId={user.id} />;
}

function SecuritySettings({ userId }: { userId: string }) {
  const api = useMemo(() => new HttpClient(process.env.NEXT_PUBLIC_API_URL || "/api"), []);
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<SetupResult | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function refresh() {
    const result = await api.request("me.mfa.status") as Envelope<Status>;
    setStatus(result.data);
  }
  async function retryStatus() {
    if (busy) return;
    setBusy(true); setError("");
    try { await refresh(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    api.request("me.mfa.status")
      .then(r => { if (active) setStatus((r as Envelope<Status>).data); })
      .catch(e => { if (active) setError((e as Error).message); });
    return () => { active = false; };
  }, [userId, api]);

  async function act(event: FormEvent, action: "setup" | "confirm" | "stepup") {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNote("");
    try {
      if (action === "setup") {
        const result = await api.request("me.mfa.setup", { body: { password } }) as Envelope<SetupResult>;
        setSetup(result.data); setPassword("");
        setNote("Anahtarı doğrulayıcı uygulamana ekle, sonra altı haneli kodu gir. Anahtar bu ekrandan ayrılınca gösterilmez.");
      } else if (action === "confirm") {
        await api.request("me.mfa.confirm", { body: { code } });
        setSetup(null); setCode(""); setNote("İki adımlı doğrulama etkin.");
        await refresh();
      } else {
        await api.request("me.mfa.stepup", { body: { code } });
        setCode(""); setNote("Yeniden doğrulama başarılı. Onay yalnız mevcut oturum için kısa süreli.");
        await refresh();
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="screen-stack">
    <section className="kv-card screen-stack">
      <span className="eyebrow">HESAP GÜVENLİĞİ</span>
      <h1>İki adımlı doğrulama</h1>
      <p className="kv-muted">Girişine ek olarak doğrulayıcı uygulamandaki altı haneli kodla kritik işlemleri onaylayabilirsin.</p>
      <p role="status" aria-live="polite">{status ? (status.enabled ? "TOTP doğrulaman etkin." : "TOTP doğrulaman henüz etkin değil.") : "Güvenlik durumun kontrol ediliyor."}</p>
      {error && <p role="alert" className="kv-help">{error}</p>}
      {!status && error && <button className="kv-button" disabled={busy} onClick={() => void retryStatus()}>Güvenlik durumunu tekrar yükle</button>}
      {note && <p role="status" className="kv-help">{note}</p>}
      {status && !status.enabled && !setup && <form className="screen-stack" onSubmit={e => void act(e, "setup")}>
        <label>Mevcut şifren
          <input type="password" autoComplete="current-password" required minLength={10} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        <button className="kv-button" disabled={busy || password.length < 10}>Doğrulayıcı kurulumunu başlat</button>
      </form>}
      {setup && <div className="screen-stack">
        <p className="kv-help">Kurulum bağlantısını üçüncü kişilerle paylaşma. Bu anahtar yalnız sana özeldir.</p>
        <div className="kv-card"><strong>Doğrulayıcı uygulama anahtarı</strong><code>{setup.secret}</code></div>
        <p className="kv-muted">Bu kurulum {new Date(setup.expiresAt).toLocaleTimeString("tr-TR")} saatine kadar geçerli.</p>
        <form className="screen-stack" onSubmit={e => void act(e, "confirm")}>
          <label>Doğrulama kodu
            <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} />
          </label>
          <button className="kv-button" disabled={busy || code.length !== 6}>Kurulumu doğrula</button>
        </form>
      </div>}
      {status?.enabled && <form className="screen-stack" onSubmit={e => void act(e, "stepup")}>
        <label>Kritik işlem için kodun
          <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} />
        </label>
        <button className="kv-button" disabled={busy || code.length !== 6}>Yeniden doğrula</button>
        {status.stepUpExpiresAt && <p className="kv-muted">Bu oturumun yeniden doğrulaması {new Date(status.stepUpExpiresAt).toLocaleTimeString("tr-TR")} saatine kadar geçerli.</p>}
      </form>}
      <p className="kv-help">Kritik yetki değişiklikleri için ikinci yönetici onayı altyapısı henüz tamamlanmadı. Bu ekran tek başına rol değişikliklerine onay vermez.</p>
      <Link href="/hesap">Hesabıma dön</Link>
    </section>
  </div>;
}
