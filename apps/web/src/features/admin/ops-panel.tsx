"use client";

import { useEffect, useState } from "react";
import type { AdminClient, OpsView } from "./admin-client";
import { errorMessage } from "./admin-ui";
import styles from "./admin-shell.module.css";

const numbers = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
const health = { ok: "Çalışıyor", degraded: "Uyarı", down: "Erişilemiyor", unknown: "Ölçüm yok" };
const measure = (value: number | null | undefined, unit = "") => value == null ? "Ölçüm yok" : `${numbers.format(value)}${unit}`;
const date = (value: string | null) => value ? new Date(value).toLocaleString("tr-TR") : "Ölçüm yok";

export function OpsPanel({ admin }: { admin: AdminClient }) {
  const [status, setStatus] = useState<OpsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    admin.ops(controller.signal)
      .then(value => { if (!controller.signal.aborted) setStatus(value); })
      .catch(cause => { if (!controller.signal.aborted) { setStatus(null); setError(errorMessage(cause)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [admin, attempt]);

  return <section className={`kv-stack ${styles.opsPanel}`} aria-label="Operasyon durumu">
    <div className="kv-row kv-between">
      <div><h2>Operasyon durumu</h2><p className="kv-muted">Servis sağlığı, iş kuyrukları ve güvenlik uyarıları.</p></div>
      <button className="kv-button kv-button--secondary" type="button" disabled={loading} onClick={() => retry(n => n + 1)}>Operasyon verilerini yenile</button>
    </div>
    {loading ? <p role="status" aria-live="polite">Operasyon ölçümleri yükleniyor…</p> : null}
    {error ? <p role="alert">Operasyon verileri yüklenemedi: {error} <button className="kv-button" type="button" onClick={() => retry(n => n + 1)}>Operasyonu tekrar dene</button></p> : null}
    {status && !loading && !error ? <>
      <div className={styles.grid} aria-label="Servis sağlığı">
        <article className={styles.metric}><h3>API</h3><strong>{health[status.components.api.status]}</strong><p>Çalışma süresi: {measure(status.components.api.uptimeSeconds, " sn")}</p></article>
        <article className={styles.metric}><h3>Veritabanı</h3><strong>{health[status.components.database.status]}</strong><p>Gecikme: {measure(status.components.database.latencyMs, " ms")}</p><p>Sürüm: {status.components.database.version ?? "Ölçüm yok"}</p></article>
        <article className={styles.metric}><h3>Worker</h3><strong>{health[status.components.worker.status]}</strong><p>Son iz: {date(status.components.worker.lastSeenAt)}</p><p>İz yaşı: {measure(status.components.worker.ageSeconds, " sn")}</p></article>
        <article className={styles.metric}><h3>İş kuyrukları</h3><strong>{health[status.components.queue.status]}</strong></article>
        <article className={styles.metric}><h3>API hata oranı</h3><strong>{measure(status.http.errorRate == null ? null : status.http.errorRate * 100, "%")}</strong><p>5xx: {measure(status.http.errors5xx)} / {measure(status.http.requests)} istek</p><p>P95: {measure(status.http.latencyMs?.p95, " ms")}</p></article>
        <article className={styles.metric}><h3>Güvenlik uyarıları</h3><strong>{measure(status.security.loginLockouts)} giriş kilidi</strong><p>{measure(status.security.rateLimited)} hız sınırı reddi</p></article>
      </div>
      <p className="kv-muted">İstek ve güvenlik sayaçları bu API sürecinin son {status.http.windowMinutes} dakikasını kapsar; süreç yeniden başlayınca sıfırlanır. Ölçüm alınamayan alanlar “Ölçüm yok” olarak gösterilir.</p>
      {status.components.queue.queues.length ? <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="İş kuyrukları tablosu">
        <table className={styles.table}>
          <caption>Worker kuyrukları</caption>
          <thead><tr><th scope="col">Kuyruk</th><th scope="col">Bekleyen</th><th scope="col">Çalışan</th><th scope="col">Başarısız / 24s</th><th scope="col">Tamamlanan / 24s</th><th scope="col">En eski bekleme</th></tr></thead>
          <tbody>{status.components.queue.queues.map(q => <tr key={q.name}><th scope="row">{q.name}</th><td>{measure(q.waiting)}</td><td>{measure(q.active)}</td><td>{measure(q.failed24h)}</td><td>{measure(q.completed24h)}</td><td>{q.oldestWaitingSeconds == null ? "Bekleyen iş yok" : measure(q.oldestWaitingSeconds, " sn")}</td></tr>)}</tbody>
        </table>
      </div> : <p>Kuyruk ölçümü bulunmuyor.</p>}
      <article className="kv-card"><h3>Yedek ve geri yükleme</h3><p>Yedek durumu: {health[status.backup.status]} · Son yedek: {date(status.backup.lastBackupAt)}</p>
        {status.backup.restoreDrill ? <p>Son kayıtlı geri yükleme tatbikatı: {status.backup.restoreDrill.at} · {status.backup.restoreDrill.environment} · {measure(status.backup.restoreDrill.rtoSeconds, " sn")}</p> : <p>Geri yükleme tatbikatı bilgisi yok.</p>}
      </article>
      <p className="kv-muted">Ortam: {status.release.env} · Sürüm: {status.release.sha ?? "Ölçüm yok"} · Son güncelleme: <time dateTime={status.generatedAt}>{date(status.generatedAt)}</time></p>
    </> : null}
  </section>;
}
