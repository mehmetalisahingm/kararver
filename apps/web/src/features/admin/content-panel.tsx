"use client";

// Anket ve yorum moderasyonu (KV-37). Sözleşmede yönetici için içerik arama/liste endpoint'i yok; işlem içeriğin
// kimliğiyle yapılır (rapor kuyruğundan, bildirimden ya da profilden gelen kimlik). Kuyruktan gelen içerik için
// "Raporlar" ekranında doğrudan işlem düğmesi vardır.
import { useState } from "react";
import { AdminClient } from "./admin-client.ts";
import type { ContentKind, ModerationAction, ModerationOutcome } from "./admin-client.ts";
import { errorMessage, useNotice } from "./admin-ui";
import styles from "./admin-shell.module.css";

const actions: Record<ContentKind, [ModerationAction, string][]> = {
  polls: [
    ["HIDE", "Gizle"],
    ["RESTORE", "Geri yükle"],
    ["LOCK", "Kilitle"],
    ["UNLOCK", "Kilidi aç"],
    ["REMOVE", "Kaldır"],
    ["EXCLUDE_FROM_TRENDS", "Trendden çıkar"],
    ["INCLUDE_IN_TRENDS", "Trende geri al"],
  ],
  comments: [
    ["HIDE", "Gizle"],
    ["RESTORE", "Geri yükle"],
    ["REMOVE", "Kaldır"],
  ],
};
const statusLabels: Record<string, string> = { ACTIVE: "Yayında", HIDDEN: "Gizli", LOCKED: "Kilitli", REMOVED: "Kaldırıldı", UNDER_REVIEW: "İncelemede" };
const UUID = /^[0-9a-f-]{36}$/i;

export function ContentPanel({ admin, kind }: { admin: AdminClient; kind: ContentKind }) {
  const [id, setId] = useState("");
  const [action, setAction] = useState<ModerationAction>("HIDE");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ModerationOutcome | null>(null);
  const { setNotice, element } = useNotice();
  const noun = kind === "polls" ? "anket" : "yorum";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setResult(null);
    if (!UUID.test(id.trim())) return setError(`Geçerli bir ${noun} kimliği gir.`);
    if (reason.trim().length < 3) return setError("Gerekçe en az 3 karakter olmalı.");
    setBusy(true);
    setError("");
    try {
      const outcome = await admin.moderate(kind, id.trim(), action, reason.trim());
      setResult(outcome);
      setNotice("İşlem uygulandı ve audit kaydına yazıldı.");
      setReason("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.inlineForm} onSubmit={submit}>
      <p className="kv-muted">
        Moderatör yalnız atandığı topluluğun içeriğine işlem yapar. Gizleme, kaldırma ve kilitleme içeriğin açık raporlarını da kapatır;
        kaldırılmış içeriği yalnız yönetici geri yükler.
      </p>
      <label>
        {kind === "polls" ? "Anket" : "Yorum"} kimliği
        <input className="kv-input" value={id} onChange={(event) => setId(event.target.value)} placeholder="UUID" required />
      </label>
      <label>
        İşlem
        <select className="kv-input" value={action} onChange={(event) => setAction(event.target.value as ModerationAction)}>
          {actions[kind].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>
        Gerekçe
        <textarea className="kv-input" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required />
      </label>
      {error ? <p role="alert" className={styles.formError}>{error}</p> : null}
      {element}
      {result ? (
        <p className="kv-muted">
          Durum: <strong>{statusLabels[result.status] ?? result.status}</strong>
          {result.trendExcluded !== null ? <> · Trend: <strong>{result.trendExcluded ? "dışında" : "dahil"}</strong></> : null}
        </p>
      ) : null}
      <div><button className="kv-button" type="submit" disabled={busy}>{busy ? "İşleniyor…" : "Uygula"}</button></div>
    </form>
  );
}
