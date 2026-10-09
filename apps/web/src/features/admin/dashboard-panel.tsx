"use client";

import { useEffect, useState } from "react";
import type { AdminClient, MetricsView } from "./admin-client";
import { errorMessage } from "./admin-ui";
import styles from "./admin-shell.module.css";

type Range = "7d" | "30d";
const number = new Intl.NumberFormat("tr-TR");

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return <article className={styles.metric}><span className="kv-muted">{label}</span><strong>{value === undefined ? "—" : number.format(value)}</strong></article>;
}

export function DashboardPanel({ admin }: { admin: AdminClient }) {
  const [range, setRange] = useState<Range>("7d");
  const [metrics, setMetrics] = useState<MetricsView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, retry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setLoading(true);
    admin.metrics(controller.signal, range)
      .then(value => { if (!controller.signal.aborted) setMetrics(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [admin, range, attempt]);

  const current = metrics?.range === range ? metrics : null;

  return (
    <section className="kv-stack" aria-label="Canlı yönetim metrikleri">
      <div className="kv-row kv-between">
        <label>Dönem
          <select className="kv-input" value={range} onChange={event => setRange(event.target.value as Range)}>
            <option value="7d">Son 7 gün</option>
            <option value="30d">Son 30 gün</option>
          </select>
        </label>
        <button className="kv-button kv-button--secondary" type="button" onClick={() => retry(n => n + 1)} disabled={loading}>
          Verileri yenile
        </button>
      </div>

      {loading ? <p role="status" aria-live="polite">Gerçek veriler yükleniyor…</p> : null}
      {error ? <p role="alert">Metrikler yüklenemedi: {error} <button className="kv-button" type="button" onClick={() => retry(n => n + 1)}>Tekrar dene</button></p> : null}

      {current && !loading && !error ? <>
        <div className={styles.grid} aria-label="Veritabanından gelen toplamlar">
          <Stat label="Kullanıcı (silinmemiş)" value={current.totals.users} />
          <Stat label="Anket (silinmemiş)" value={current.totals.polls} />
          <Stat label="Toplam oy" value={current.totals.votes} />
          <Stat label="Yorum (silinmemiş)" value={current.totals.comments} />
          <Stat label="Açık rapor" value={current.totals.openReports} />
          <Stat label="Aktif kullanıcı / son 24 saat" value={current.totals.activeUsers24h} />
          <Stat label="Yeni kayıt / son 24 saat" value={current.totals.registrations24h} />
          <Stat label="Aktif topluluk" value={current.totals.activeCommunities} />
          <Stat label="Kaldırılan anket" value={current.totals.removedPolls} />
          <Stat label="Kaldırılan yorum" value={current.totals.removedComments} />
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption>Son {range === "7d" ? "7" : "30"} gün: günlük kayıt, oturum açan kullanıcı ve içerik hareketleri</caption>
            <thead>
              <tr>
                <th scope="col">Gün (UTC)</th>
                <th scope="col">Oturum açan tekil kullanıcı</th>
                <th scope="col">Kayıt</th>
                <th scope="col">Anket</th>
                <th scope="col">Oy</th>
                <th scope="col">Yorum</th>
              </tr>
            </thead>
            <tbody>
              {current.series.map(day => (
                <tr key={day.localDate}>
                  <th scope="row">{day.localDate}</th>
                  <td>{number.format(day.activeUsers)}</td>
                  <td>{number.format(day.registrations)}</td>
                  <td>{number.format(day.polls)}</td>
                  <td>{number.format(day.votes)}</td>
                  <td>{number.format(day.comments)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="kv-muted">
          Son güncelleme: <time dateTime={current.generatedAt}>{new Date(current.generatedAt).toLocaleString("tr-TR")}</time>.
          Günlük tablo kullanıcı metriği oturum açma olaylarından, son 24 saat aktif kullanıcı metriği ise geçerli oturumların son kullanımından hesaplanır; ikisi de gerçek zamanlı çevrimiçi kullanıcı sayısı değildir.
          Servis hata oranı ve worker durumu henüz bu API'den gelmiyor; değer uydurulmaz.
        </p>
      </> : null}
    </section>
  );
}
