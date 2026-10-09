"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminClient, type CommunityRequestRecord } from "./admin-client.ts";

const STATUS_LABEL = {
  PENDING: "Beklemede",
  APPROVED: "Onaylandı",
  REJECTED: "Reddedildi",
  CLOSED: "7 gün / 10 üye eşiği nedeniyle kapalı",
} as const;

export function CommunityRequestQueue({ admin }: { admin: AdminClient }) {
  const [items, setItems] = useState<CommunityRequestRecord[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<keyof typeof STATUS_LABEL>("PENDING");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => setItems(await admin.communityRequests(status)), [admin, status]);

  useEffect(() => {
    let current = true;
    admin.communityRequests(status)
      .then((data) => { if (current) setItems(data); })
      .catch(() => { if (current) setError("Başvurular yüklenemedi."); });
    return () => { current = false; };
  }, [admin, status]);

  async function decide(item: CommunityRequestRecord, decision: "APPROVE" | "REJECT") {
    if (busyId) return;
    const explanation = (reason[item.id] ?? "").trim();
    if (explanation.length < 3) { setError("Onay ve red işlemlerinde en az 3 karakterlik gerekçe zorunlu."); return; }
    setError(""); setNotice(""); setBusyId(item.id);
    try {
      await admin.decideCommunityRequest(item.id, decision, explanation);
      await load();
      setNotice(decision === "APPROVE" ? "Topluluk açıldı; 7 günlük sayaç başladı." : "Başvuru gerekçeyle reddedildi.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "İşlem tamamlanamadı.");
    } finally { setBusyId(null); }
  }

  return (
    <section className="screen-stack" aria-labelledby="community-queue-heading">
      <h3 id="community-queue-heading">Kullanıcı topluluk başvuruları</h3>
      <label>Durum filtresi
        <select className="kv-input" value={status} onChange={(event) => setStatus(event.target.value as keyof typeof STATUS_LABEL)}>
          {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!items.length ? <p className="kv-muted">Bu durumda başvuru yok.</p> : null}
      {items.map((item) => (
        <article key={item.id} className="kv-card screen-stack">
          <div className="kv-row kv-between">
            <strong>{item.name}</strong>
            <span className="kv-badge kv-badge--neutral">{STATUS_LABEL[item.status]}</span>
          </div>
          <p className="kv-muted">/{item.slug} · {item.description || "Açıklama yok"} · {item.memberCount} üye</p>
          <p className="kv-muted">Başvuru tarihi: {new Date(item.createdAt).toLocaleDateString("tr-TR")}</p>
          {item.approvalDeadline ? <p>7 günlük son tarih: {new Date(item.approvalDeadline).toLocaleDateString("tr-TR")}</p> : null}
          {item.status === "REJECTED" ? <p>Red gerekçesi: {item.rejectionReason}</p> : null}
          {item.status === "PENDING" ? (
            <>
              <label>Karar gerekçesi
                <textarea className="kv-input" rows={2} minLength={3} maxLength={500}
                  value={reason[item.id] ?? ""}
                  onChange={(event) => setReason((previous) => ({ ...previous, [item.id]: event.target.value }))} />
              </label>
              <div className="kv-row">
                <button className="kv-button" disabled={!!busyId} onClick={() => void decide(item, "APPROVE")}>Onayla</button>
                <button className="kv-button kv-button--secondary" disabled={!!busyId} onClick={() => void decide(item, "REJECT")}>Reddet</button>
              </div>
            </>
          ) : null}
        </article>
      ))}
    </section>
  );
}
