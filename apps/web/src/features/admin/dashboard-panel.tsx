"use client";
import { useEffect, useState } from "react";
import type { AdminClient, MetricsView } from "./admin-client";
import { errorMessage } from "./admin-ui";
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
  return <section className="kv-card"><p>Kullanıcı: {metrics.totals.users} · Gönderi: {metrics.totals.polls} · Oy: {metrics.totals.votes} · Yorum: {metrics.totals.comments} · Açık rapor: {metrics.totals.openReports}</p><p>Güncelleme: {new Date(metrics.generatedAt).toLocaleString("tr-TR")}</p></section>;
}
