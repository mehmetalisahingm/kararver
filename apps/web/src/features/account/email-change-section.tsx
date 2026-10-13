"use client";
// Hesap sayfasındaki e-posta değişimi bölümü (#181): parola ile sahiplik kanıtı, yeni adres, talep durumu ve iptal.
// Yalnız gerçek API modunda görünür. Ayar kapalıysa sunucu 503 döner ve mesaj gösterilir.
import { FormEvent, useCallback, useEffect, useState } from "react";
import type { EmailChangeView } from "@kararver/contracts";
import { ErrorMessage } from "../../components/fields";
import type { ApiClient } from "../../lib/api-client";
import { statusLine } from "./email-change-model";

type View = ReturnType<typeof EmailChangeView.parse>;

export function EmailChangeSection({ client, currentEmail }: { client: ApiClient; currentEmail: string }) {
  const [view, setView] = useState<View | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => client.getEmailChange().then(setView).catch(() => undefined), [client]);
  useEffect(() => { void load(); }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await client.requestEmailChange(newEmail.trim(), password);
      setPassword("");
      if (result.status === "SEND_FAILED") {
        setError("Doğrulama e-postaları gönderilemedi; talep açılmadı. Biraz sonra tekrar dene.");
      } else {
        setNotice("Yeni adrese bir doğrulama bağlantısı, mevcut adresine bir onay bağlantısı gönderdik. İkisi de tamamlanmadan e-postan değişmez.");
        setNewEmail("");
      }
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await client.cancelEmailChange();
      setNotice("Talep iptal edildi.");
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const open = view?.status === "OPEN";
  return (
    <section className="kv-card screen-stack" aria-labelledby="email-change-title">
      <div>
        <span className="eyebrow">HESAP GÜVENLİĞİ</span>
        <h2 id="email-change-title">E-posta adresini değiştir</h2>
        <p className="kv-muted">Mevcut adresin: {currentEmail}. Değişiklik için parolan, yeni adresin doğrulaması ve mevcut adresinden onay gerekir; tamamlanınca bütün oturumların kapanır.</p>
      </div>
      {view ? <p role="status">{statusLine(view)}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <form className="screen-stack" onSubmit={submit}>
        <label>
          Yeni e-posta adresi
          <input type="email" value={newEmail} maxLength={254} required autoComplete="email" onChange={(e) => setNewEmail(e.target.value)} />
        </label>
        <label>
          Mevcut parolan
          <input type="password" value={password} required autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
        </label>
        <ErrorMessage message={error} />
        <div className="kv-row">
          <button className="kv-button" disabled={busy || !newEmail.trim() || !password} aria-busy={busy}>{open ? "Yeni talep aç (öncekini iptal eder)" : "Doğrulama bağlantılarını gönder"}</button>
          {open ? <button type="button" className="kv-button kv-button--secondary" disabled={busy} onClick={() => void cancel()}>Talebi iptal et</button> : null}
        </div>
      </form>
    </section>
  );
}
