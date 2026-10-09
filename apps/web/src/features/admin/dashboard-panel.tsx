"use client";
import { useEffect, useState } from "react";
import type { AdminClient, MetricsView } from "./admin-client";
import { errorMessage } from "./admin-ui";
import styles from "./admin-shell.module.css";
export function DashboardPanel({ admin }: { admin: AdminClient }) {
  const [metrics, setMetrics] = useState<MetricsView | null>(null);
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    admin.metrics(controller.signal).then(value => { if (!controller.signal.aborted) setMetrics(value); }).catch(cause => { if (!controller.signal.aborted) setError(errorMessage(cause)); });
    return () => controller.abort();
  }, [admin, attempt]);
  if (error) return <p role="alert">{error}<button onClick={() => retry(n => n + 1)}>Tekrar dene</button></p>;
  if (!metrics) return <p role="status">Gerçek veriler yükleniyor…</p>;
  const maximum = Math.max(1, ...metrics.series.map(day => day.votes));
  return <section className="kv-stack">
    <div className={styles.grid} aria-label="Platform toplamları">
      {([["Kullanıcı", metrics.totals.users], ["Gönderi", metrics.totals.polls], ["Oy", metrics.totals.votes], ["Yorum", metrics.totals.comments], ["Açık rapor", metrics.totals.openReports]] as const).map(([label, value]) => <article className={`kv-card ${styles.metric}`} key={label}><span className="kv-muted">{label}</span><strong>{value.toLocaleString("tr-TR")}</strong></article>)}
    </div>
    <article className="kv-card"><h2>Günlük oy hareketi</h2>
      <div style={{ display: "flex", alignItems: "end", gap: 12, minHeight: 160, overflowX: "auto" }}>
        {metrics.series.map(day => <div key={day.localDate} style={{ flex: "1 0 48px", textAlign: "center" }}>
          <span>{day.votes.toLocaleString("tr-TR")}</span>
          <div aria-hidden="true" style={{ height: Math.max(3, day.votes / maximum * 100), background: "var(--kv-accent, #7357e8)", borderRadius: "8px 8px 0 0", margin: "8px 0" }} />
          <small>{day.localDate.slice(5)}</small>
        </div>)}
      </div>
      <details><summary>Günlük veriler</summary><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Tarih</th><th>Yeni kullanıcı</th><th>Gönderi</th><th>Oy</th><th>Yorum</th></tr></thead><tbody>{metrics.series.map(day => <tr key={day.localDate}><td>{day.localDate}</td><td>{day.registrations}</td><td>{day.polls}</td><td>{day.votes}</td><td>{day.comments}</td></tr>)}</tbody></table></div></details>
    </article>
    <p className="kv-muted">Son güncelleme: {new Date(metrics.generatedAt).toLocaleString("tr-TR")}</p>
    <button className="kv-button kv-button--secondary" onClick={() => retry(n => n + 1)}>Verileri yenile</button>
  </section>;
}
