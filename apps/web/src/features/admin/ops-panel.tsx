"use client";

import { securityAlertRule, SecurityAlertRuleId } from "@kararver/contracts";
import { useEffect, useState } from "react";
import type { AdminClient, OpsView } from "./admin-client";
import { ActionDialog, errorMessage } from "./admin-ui";
import styles from "./admin-shell.module.css";

const numbers = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
const health = { ok: "Çalışıyor", degraded: "Uyarı", down: "Erişilemiyor", unknown: "Ölçüm yok" };
const measure = (value: number | null | undefined, unit = "") => value == null ? "Ölçüm yok" : `${numbers.format(value)}${unit}`;
const date = (value: string | null) => value ? new Date(value).toLocaleString("tr-TR") : "Ölçüm yok";
const switchLabel = { maintenance: "Bakım modu", registration: "Yeni kayıt", pollCreation: "Anket oluşturma", comments: "Yorumlar", uploads: "Görsel yükleme" } as const;
/** Bakım modu açıkken, diğerleri kapalıyken olağandışıdır (acil durum). */
const switchState = (name: keyof typeof switchLabel, enabled: boolean) =>
  name === "maintenance" ? (enabled ? "Açık: site bakımda" : "Kapalı") : (enabled ? "Açık" : "Kapalı (acil durum)");

export function OpsPanel({ admin }: { admin: AdminClient }) {
  const [status, setStatus] = useState<OpsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  // Yeniden yüklemede alarm bölümü kısa süre kalkar; işlem sonucu burada kalır.
  const [notice, setNotice] = useState("");
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
    {notice ? <p role="status">{notice}</p> : null}
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
      <article className="kv-card"><h3>Güvenlik olayları (bütün sunucular)</h3>
        <p>Şu an kilitli giriş: {status.security.lockedLogins ? `${measure(status.security.lockedLogins.emails)} e-posta · ${measure(status.security.lockedLogins.ips)} IP` : "Ölçüm yok"}</p>
        {status.security.adminActions24h == null ? <p>Kritik yönetici işlemleri: Ölçüm yok</p>
          : status.security.adminActions24h.length === 0 ? <p>Son 24 saatte kritik yönetici işlemi yok.</p>
          : <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Kritik yönetici işlemleri tablosu">
            <table className={styles.table}>
              <caption>Son 24 saatteki kritik yönetici işlemleri</caption>
              <thead><tr><th scope="col">İşlem</th><th scope="col">Tür</th><th scope="col">Sayı</th></tr></thead>
              <tbody>{status.security.adminActions24h.map(a => <tr key={`${a.action}:${a.operation}`}><th scope="row">{a.action}</th><td>{a.operation}</td><td>{measure(a.count)}</td></tr>)}</tbody>
            </table>
          </div>}
      </article>
      <SecurityAlerts admin={admin} alerts={status.security.alerts} onAcked={(message) => { setNotice(message); retry(n => n + 1); }} />
      <article className="kv-card"><h3>Acil durum anahtarları</h3>
        {status.switches == null ? <p>Anahtar durumu: Ölçüm yok</p> : <>
          <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Acil durum anahtarları tablosu">
            <table className={styles.table}>
              <caption>Etkin değerler ve son değişiklik</caption>
              <thead><tr><th scope="col">Anahtar</th><th scope="col">Durum</th><th scope="col">Son değişiklik</th></tr></thead>
              <tbody>{status.switches.items.map(s => <tr key={s.name}><th scope="row">{switchLabel[s.name]}</th><td>{switchState(s.name, s.enabled)}</td><td>{s.changedAt ? date(s.changedAt) : "Hiç değiştirilmedi"}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="kv-muted">Değişiklik en geç {measure(status.switches.propagationSeconds, " sn")} içinde bütün sunuculara yayılır. Anahtarlar Ayarlar bölümünden değiştirilir: yalnız SUPER_ADMIN, gerekçe zorunlu, audit'e yazılır.</p>
        </>}
      </article>
      <article className="kv-card"><h3>Yedek ve geri yükleme</h3><p>Yedek durumu: {health[status.backup.status]} · Son yedek: {date(status.backup.lastBackupAt)}</p>
        {status.backup.restoreDrill ? <p>Son kayıtlı geri yükleme tatbikatı: {status.backup.restoreDrill.at} · {status.backup.restoreDrill.environment} · {measure(status.backup.restoreDrill.rtoSeconds, " sn")}</p> : <p>Geri yükleme tatbikatı bilgisi yok.</p>}
      </article>
      <p className="kv-muted">Ortam: {status.release.env} · Sürüm: {status.release.sha ?? "Ölçüm yok"} · Son güncelleme: <time dateTime={status.generatedAt}>{date(status.generatedAt)}</time></p>
    </> : null}
  </section>;
}

const severityLabel = { CRITICAL: "Kritik", HIGH: "Yüksek" } as const;

/** #185 kritik güvenlik alarmları: açıklar önce, sonra son 24 saatte kapananlar. Önem ve durum metinle yazılır (renk tek başına anlam taşımaz). */
function SecurityAlerts({ admin, alerts, onAcked }: { admin: AdminClient; alerts: OpsView["security"]["alerts"]; onAcked: (message: string) => void }) {
  const open = alerts?.filter(a => a.status === "OPEN") ?? [];
  const closed = alerts?.filter(a => a.status === "RESOLVED") ?? [];
  const [acking, setAcking] = useState<NonNullable<typeof alerts>[number] | null>(null);
  return <article className="kv-card" id="guvenlik-alarmlari" aria-labelledby="guvenlik-alarmlari-baslik">
    <h3 id="guvenlik-alarmlari-baslik">Güvenlik alarmları</h3>
    {alerts == null ? <p>Alarm durumu: Ölçüm yok</p> : <>
      <p role="status">{open.length ? `${numbers.format(open.length)} açık alarm var.` : "Açık alarm yok."}</p>
      {alerts.length ? <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Güvenlik alarmları tablosu">
        <table className={styles.table}>
          <caption>Açık alarmlar ve son 24 saatte kapananlar</caption>
          <thead><tr><th scope="col">Alarm</th><th scope="col">Önem</th><th scope="col">Durum</th><th scope="col">Kapsam</th><th scope="col">En yüksek sayı</th><th scope="col">Açıldı</th><th scope="col">Son görülme / kapanış</th><th scope="col">İlk adım</th><th scope="col">İnceleme</th></tr></thead>
          <tbody>{[...open, ...closed].map(a => {
            const rule = SecurityAlertRuleId.safeParse(a.rule);
            const r = rule.success ? securityAlertRule(rule.data) : null;
            return <tr key={a.id} data-status={a.status}>
              <th scope="row">{r?.label ?? a.rule}</th>
              <td>{severityLabel[a.severity]}</td>
              <td>{a.status === "OPEN" ? "Açık" : "Kapandı"}</td>
              <td>{a.actor ? <span title={a.actor.id}>{a.actor.displayName} <small className="kv-muted">@{a.actor.username}</small></span> : "Genel"}</td>
              <td>{measure(a.peakCount)}{r ? <small className="kv-muted"> (eşik {r.threshold} / {r.windowMinutes} dk)</small> : null}</td>
              <td>{date(a.openedAt)}</td>
              <td>{a.status === "OPEN" ? date(a.lastSeenAt) : date(a.resolvedAt)}</td>
              <td>{r?.firstStep ?? "—"}</td>
              <td>{a.acknowledgedBy && a.acknowledgedAt
                ? <>İncelendi: {a.acknowledgedBy.displayName} <small className="kv-muted">{date(a.acknowledgedAt)}</small></>
                : <button className="kv-button kv-button--secondary" type="button" aria-label={`İncelendi olarak işaretle: ${r?.label ?? a.rule}`} onClick={() => setAcking(a)}>İncelendi olarak işaretle</button>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div> : null}
      {acking ? <ActionDialog
        open
        title="Alarmı incelendi olarak işaretle"
        description={`${SecurityAlertRuleId.safeParse(acking.rule).success ? securityAlertRule(acking.rule as SecurityAlertRuleId).label : acking.rule} · ${date(acking.openedAt)}. İşaret alarmı kapatmaz; kim ve ne zaman incelediği audit'e gerekçeyle yazılır.`}
        submitLabel="İncelendi olarak işaretle"
        onClose={() => setAcking(null)}
        onSubmit={async (reason) => {
          await admin.ackSecurityAlert(acking.id, reason);
          setAcking(null);
          onAcked("Alarm incelendi olarak işaretlendi.");
        }}
      /> : null}
      <p className="kv-muted">Alarmlar audit kayıtlarından ve reddedilen yönetici isteklerinden 5 dakikada bir hesaplanır; açılınca SUPER_ADMIN'lere bildirim gider, sayı eşiğin altına inince kendiliğinden kapanır. Ayrıntı için audit ekranında aktörü ve zaman aralığını süz. Runbook: KV-49 “Güvenlik alarmları”.</p>
    </>}
  </article>;
}
