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
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

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
    Promise.all([api.request("me.mfa.status"), api.request("me.get")])
      .then(([r, me]) => { if (active) {
        const identity = (me as Envelope<{ id: string; roles: string[] }>).data;
        if (identity.id !== userId) throw new Error("Oturum değişti. Sayfayı tekrar aç.");
        setStatus((r as Envelope<Status>).data);
        setIsSuperAdmin(identity.roles.includes("SUPER_ADMIN"));
      } })
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
        const confirmed = await api.request("me.mfa.confirm", { body: { code } }) as Envelope<{ recoveryCodes: string[] }>;
        setRecoveryCodes(confirmed.data.recoveryCodes);
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

  async function recover(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNote("");
    try {
      await api.request("me.mfa.recover", { body: { password, code: recoveryCode.trim() } });
      setPassword(""); setRecoveryCode(""); setRecovering(false);
      setNote("Kurtarma kodu kullanıldı. Mevcut oturumun kısa süreli yeniden doğrulandı.");
      await refresh();
    } catch (cause) { setError((cause as Error).message); }
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
      {recoveryCodes.length > 0 && <section className="kv-card screen-stack" aria-label="Kurtarma kodların">
        <h2>Kurtarma kodlarını güvenli bir yerde sakla</h2>
        <p>Her kod bir kez kullanılabilir. Bu ekrandan ayrılınca tekrar gösterilmez.</p>
        <ul>{recoveryCodes.map(value => <li key={value}><code>{value}</code></li>)}</ul>
        <button className="kv-button" onClick={() => setRecoveryCodes([])}>Kodları sakladım, gizle</button>
      </section>}
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
      {status?.enabled && <><button className="kv-button kv-button--secondary" onClick={() => { setRecovering(!recovering); setPassword(""); setRecoveryCode(""); }}>Doğrulayıcıma erişemiyorum</button>
        {recovering && <form className="screen-stack" onSubmit={e => void recover(e)}>
          <label>Kurtarma için mevcut şifren<input type="password" autoComplete="current-password" required minLength={10} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} /></label>
          <label>Kurtarma kodun<input autoComplete="off" required pattern="[a-fA-F0-9]{32}" maxLength={32} value={recoveryCode} onChange={e => setRecoveryCode(e.target.value)} /></label>
          <button className="kv-button" disabled={busy}>Kurtarma kodunu kullan</button>
        </form>}
      </>}
      <p className="kv-help">Yeniden doğrulama, kritik işlemde bir kez kullanılır. Rol değişimi ikinci bir süper adminin bağımsız onayını da gerektirir; koruma sunucudaki etkinleştirme ayarına bağlıdır.</p>
      <Link href="/hesap">Hesabıma dön</Link>
    </section>
    {isSuperAdmin && <RoleApprovals api={api} userId={userId} />}
  </div>;
}

type Approval = { id: string; userId: string; initiatorId: string; role: string; expectedRole: string; reason: string; status: string; expiresAt: string };
function RoleApprovals({ api, userId }: { api: HttpClient; userId: string }) {
  const [target, setTarget] = useState("");
  const [role, setRole] = useState("SUPER_ADMIN");
  const [reason, setReason] = useState("");
  const [approvalId, setApprovalId] = useState("");
  const [approval, setApproval] = useState<Approval | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(event: FormEvent, action: "request" | "get" | "approve") {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      let id = approvalId.trim();
      if (action === "request") {
        const result = await api.request("admin.roleApprovals.request", { body: { userId: target.trim(), role, reason } }) as Envelope<{ id: string }>;
        id = result.data.id; setApprovalId(id);
      } else if (action === "approve") {
        if (!approval || approval.id !== id || approval.initiatorId === userId) throw new Error("Önce farklı yöneticinin talebini kontrol et.");
        await api.request("admin.roleApprovals.approve", { params: { id }, body: { reason: "Hedef, rol ve gerekçe bağımsız incelendi." } });
      }
      const result = await api.request("admin.roleApprovals.get", { params: { id } }) as Envelope<Approval>;
      setApproval(result.data);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="kv-card screen-stack" aria-label="Kritik rol onayları">
    <h2>Kritik rol onayları</h2>
    <p>Önce MFA ile yeniden doğrula. Talebi ikinci bir süper admin inceler ve kendi MFA doğrulamasıyla onaylar. Talep 10 dakika geçerlidir.</p>
    {error && <p role="alert">{error}</p>}
    <form className="screen-stack" onSubmit={e => void act(e, "request")}>
      <label>Hedef kullanıcı numarası<input className="kv-input" required value={target} onChange={e => setTarget(e.target.value)} /></label>
      <label>İstenen rol<select className="kv-input" value={role} onChange={e => setRole(e.target.value)}>{["USER", "MODERATOR", "ADMIN", "SUPER_ADMIN"].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Rol değişimi gerekçesi<textarea className="kv-input" required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button className="kv-button" disabled={busy}>İkinci yöneticiye onay talebi oluştur</button>
    </form>
    <form className="screen-stack" onSubmit={e => void act(e, "get")}>
      <label>İncelenecek onay numarası<input className="kv-input" required value={approvalId} onChange={e => { setApprovalId(e.target.value); setApproval(null); }} /></label>
      <button className="kv-button kv-button--secondary" disabled={busy}>Onay talebini incele</button>
    </form>
    {approval && <div className="kv-card screen-stack" role="region" aria-label="Onay talebi ayrıntıları">
      <p>Onay numarası: <code>{approval.id}</code></p>
      <p>Hedef: <code>{approval.userId}</code> · {approval.expectedRole} → {approval.role}</p>
      <p>Talep eden: <code>{approval.initiatorId}</code></p>
      <p>Gerekçe: {approval.reason}</p>
      <p role="status">Durum: {approval.status} · Son geçerlilik: {new Date(approval.expiresAt).toLocaleString("tr-TR")}</p>
      {approval.status === "PENDING" && approval.initiatorId !== userId && approval.userId !== userId && <form onSubmit={e => void act(e, "approve")}><button className="kv-button" disabled={busy}>Bağımsız incelemeyi MFA ile onayla</button></form>}
      {approval.status === "APPROVED" && approval.initiatorId === userId && <p>Yeniden MFA doğrulaması yap; kullanıcı yönetiminde aynı hedef, rol ve gerekçeyle bu onay numarasını kullan.</p>}
    </div>}
  </section>;
}
