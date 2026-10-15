"use client";
// Hesap sayfasındaki "Hesabımı sil" bölümü (#181): önizleme (silinecek/korunacak), engeller, yeniden kimlik doğrulama (parola,
// MFA açıksa kod), yazılı teyit ve açık talep durumu. Bu adım hesabı SİLMEZ; onay e-postadaki bağlantıdadır.
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ErrorMessage } from "../../components/fields";
import type { ApiClient } from "../../lib/api-client";
import { confirmationMatches, removalLines, retainedLine } from "../admin/erasure-model";
import { deletionStatusLine, SELF_BLOCKER_TEXT, type SelfDeletionPreviewView } from "./deletion-model";

export function DeletionSection({ client }: { client: ApiClient }) {
  const [preview, setPreview] = useState<SelfDeletionPreviewView | null>(null);
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => client.getDeletionPreview().then(setPreview).catch(() => undefined), [client]);
  useEffect(() => { void load(); }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !preview) return;
    if (!confirmationMatches(typed, preview.username)) return setError("Onay için kullanıcı adını aynen yaz.");
    setBusy(true);
    setError("");
    setNotice("");
    try {
      // MFA açıksa taze step-up önce; sunucu onu talep transaction'ında bir kez tüketir.
      if (preview.mfaRequired) await client.mfaStepUp(code);
      const result = await client.requestDeletion(password, typed.trim());
      setPassword("");
      setCode("");
      if (result.status === "SEND_FAILED") setError("Onay e-postası gönderilemedi; talep açılmadı. Biraz sonra tekrar dene.");
      else setNotice("Hesabının e-postasına bir onay bağlantısı gönderdik. Hesabın, bağlantıyı onaylamadıkça silinmez; bağlantı 24 saat geçerlidir.");
      await load();
    } catch (cause) {
      setError((cause as Error).message);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await client.cancelDeletion();
      setNotice("Silme talebi iptal edildi.");
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!preview) return null;
  const open = preview.request?.status === "OPEN";
  return (
    <section className="kv-card screen-stack" aria-labelledby="deletion-title">
      <div>
        <span className="eyebrow">TEHLİKELİ BÖLGE</span>
        <h2 id="deletion-title">Hesabımı sil</h2>
        <p className="kv-muted">Silme geri alınamaz. Kişisel bilgilerin silinir, paylaşım ve yorum metinlerin kaldırılır, oyların hesabınla bağı koparılır ve oturumların kapanır.</p>
      </div>
      {!preview.enabled ? <p className="kv-muted">Hesap silme şu an kapalı. Silme talebi için destek ile iletişime geç.</p> : (
        <>
          <ul>{removalLines(preview.willRemove).map((line) => <li key={line}>{line}</li>)}</ul>
          <p className="kv-muted">{retainedLine(preview.willRetain)}</p>
          {preview.blockers.length > 0 ? <ul role="alert" aria-label="Silmeyi engelleyenler">{preview.blockers.map((code) => <li key={code}>{SELF_BLOCKER_TEXT[code]}</li>)}</ul> : null}
        </>
      )}
      {preview.request ? <p role="status">{deletionStatusLine(preview.request)}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {preview.enabled ? (
        <form className="screen-stack" onSubmit={submit}>
          <label>
            Mevcut parolan
            <input type="password" value={password} required autoComplete="current-password" disabled={!preview.canRequest} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {preview.mfaRequired ? (
            <label>
              Doğrulayıcı kodun
              <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} required disabled={!preview.canRequest} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </label>
          ) : null}
          <label>
            Onay için kullanıcı adını yaz (<strong>{preview.username}</strong>)
            <input value={typed} required autoComplete="off" spellCheck={false} disabled={!preview.canRequest} onChange={(e) => setTyped(e.target.value)} />
          </label>
          <ErrorMessage message={error} />
          <div className="kv-row">
            <button className="kv-button kv-button--danger" disabled={busy || !preview.canRequest || !password || !typed.trim() || (preview.mfaRequired && code.length !== 6)} aria-busy={busy}>
              {open ? "Yeni onay bağlantısı gönder" : "Silme talebi aç ve onay e-postası gönder"}
            </button>
            {open ? <button type="button" className="kv-button kv-button--secondary" disabled={busy} onClick={() => void cancel()}>Talebi iptal et</button> : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
