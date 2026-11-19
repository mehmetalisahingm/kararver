"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LedgerEntry } from "@kararver/contracts";
import { useProduct } from "../../components/product-provider";
import { ErrorMessage, Loading } from "../../components/fields";
import { ApiClient } from "../../lib/api-client";

type Entry = ReturnType<typeof LedgerEntry.parse>;
const labels: Record<Entry["reason"], string> = { INITIAL_GRANT: "Başlangıç puanı", PUBLISH: "İçerik gönderimi", ADMIN_ADJUSTMENT: "Hesap düzeltmesi", MODERATION_REFUND: "Moderasyon iadesi" };
export function PointsHistory() {
  const { client, user } = useProduct();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [attempt, retry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setEntries([]); setCursor(undefined); setNext(null); }, [user?.id]);
  useEffect(() => {
    const controller = new AbortController();
    if (!(client instanceof ApiClient) || !user) return;
    setBusy(true); setError("");
    client.pointsLedger(cursor, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      setEntries(previous => [...new Map([...(cursor ? previous : []), ...page.data].map(row => [row.id, row])).values()]);
      setNext(page.page.nextCursor);
    }).catch(cause => { if (!controller.signal.aborted) setError((cause as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [client, user?.id, cursor, attempt]);
  return <section className="kv-card screen-stack"><h1>Puan hareketlerin</h1>
    {!user ? <Link href="/giris?returnTo=%2Fhesap%2Fpuanlar">Giriş yap</Link> : !(client instanceof ApiClient) ? <p role="status">Puan geçmişi bu ortamda kullanılamıyor.</p> : <>
      <p>Yalnız hesabına işlenmiş hareketler gösterilir. Bir iade bildirimi yeni puan oluşturmaz.</p>
      <ErrorMessage message={error} />
      {busy && <Loading label="Puan hareketleri yükleniyor…" />}
      {!busy && !error && entries.length === 0 && <p role="status">Henüz puan hareketin yok.</p>}
      <ul className="screen-stack" aria-label="Puan hareketleri">{entries.map(entry => <li key={entry.id} className="kv-card"><strong>{labels[entry.reason]} · {entry.delta > 0 ? "+" : ""}{entry.delta} puan</strong><p>İşlem sonrası bakiye: {entry.balanceAfter} puan</p><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</time></li>)}</ul>
      {error ? <button className="kv-button" disabled={busy} onClick={() => retry(n => n + 1)}>Tekrar dene</button> : next ? <button className="kv-button" disabled={busy} onClick={() => setCursor(next)}>Daha fazla göster</button> : null}
    </>}
    <Link href="/hesap">Hesabıma dön</Link>
  </section>;
}
