"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Id, MyModerationAppealView } from "@kararver/contracts";
import { useProduct } from "../../components/product-provider";
import { ErrorMessage, Loading } from "../../components/fields";
import { ApiClient } from "../../lib/api-client";
import { UiError } from "../../lib/model";

type Appeal = ReturnType<typeof MyModerationAppealView.parse>;
const date = (value: string) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(value));

export function AppealScreen({ id }: { id: string }) {
  const { client, user } = useProduct();
  const [appeal, setAppeal] = useState<Appeal | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [attempt, retry] = useState(0);
  const submitting = useRef(false);
  const valid = Id.safeParse(id).success;
  const real = client instanceof ApiClient ? client : null;
  const reload = useCallback(() => retry(n => n + 1), []);
  useEffect(() => { setReason(""); }, [id, user?.id]);
  useEffect(() => {
    const controller = new AbortController();
    setAppeal(null); setError(""); setLoading(Boolean(real && user && valid));
    if (real && user && valid) real.moderationAppeal(id, controller.signal)
      .then(view => { if (!controller.signal.aborted) setAppeal(view); })
      .catch(cause => { if (!controller.signal.aborted) setError(message(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [real, user?.id, id, valid, attempt]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!real || !appeal || appeal.status !== "OPEN" || submitting.current) return;
    if (reason.trim().length < 10) { setError("İtiraz gerekçesi en az 10 karakter olmalı."); return; }
    submitting.current = true; setBusy(true); setError("");
    try { setAppeal(await real.fileModerationAppeal(id, reason.trim())); }
    catch (cause) { setError(message(cause)); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <section className="kv-card screen-stack" aria-labelledby="appeal-title">
    <h1 id="appeal-title">Moderasyon kararına itiraz</h1>
    <p>Başvuru süresi ret bildiriminin sana tesliminden itibaren 30 gündür. Aşağıdaki son tarih sunucuda kayıtlı teslim bilgisine dayanır.</p>
    {!user ? <><p role="status">Bu özel bilgi için hesabınla giriş yapmalısın.</p><Link className="kv-button" href={`/giris?returnTo=${encodeURIComponent(`/hesap/itiraz/${id}`)}`}>Giriş yap</Link></>
      : !valid || !real ? <p role="alert">Bu başvuru bağlantısı kullanılamıyor.</p>
      : <>
        {loading && <Loading label="İtiraz durumu yükleniyor…" />}
        <ErrorMessage message={error} />
        {appeal && <>
          <dl className="screen-stack"><div><dt>Bildirim teslimi</dt><dd><time dateTime={appeal.deliveredAt}>{date(appeal.deliveredAt)}</time></dd></div><div><dt>Son başvuru tarihi</dt><dd><time dateTime={appeal.deadlineAt}>{date(appeal.deadlineAt)}</time></dd></div></dl>
          {appeal.status === "FILED" ? <p role="status">Başvurun kaydedildi{appeal.filedAt ? `: ${date(appeal.filedAt)}` : ""}. Bu, itirazın kabul edildiği veya içeriğin yayımlandığı anlamına gelmez.</p>
            : appeal.status === "EXPIRED" ? <p role="status">Bu karar için başvuru süresi dolmuş. Yeni başvuru gönderilemiyor.</p>
            : <form className="screen-stack" onSubmit={submit} aria-busy={busy}>
              <label htmlFor="appeal-reason">İtiraz gerekçen</label><textarea id="appeal-reason" className="kv-input" value={reason} onChange={e => setReason(e.target.value)} minLength={10} maxLength={1000} rows={5} disabled={busy} required />
              <p className="kv-help">10–1000 karakter. Gereksiz kimlik veya hassas kişisel bilgi ekleme.</p>
              <button className="kv-button" disabled={busy || reason.trim().length < 10}>{busy ? "Gönderiliyor…" : "İtirazımı gönder"}</button>
            </form>}
          <p>Başvuruların 14 takvim günü içinde sonuçlandırılması hedeflenir. Bu süre otomatik kabul veya kesin sonuç garantisi değildir.</p>
        </>}
        <button className="kv-button kv-button--secondary" disabled={busy || loading} onClick={reload}>Durumu tekrar kontrol et</button>
      </>}
    <Link href="/bildirimler">Bildirimlere dön</Link>
    <Link href="/hesap/puanlar">Puan hareketlerimi gör</Link>
  </section>;
}
function message(cause: unknown) {
  if (cause instanceof UiError && ["NOT_FOUND", "FORBIDDEN"].includes(cause.code)) return "Bu başvuru bilgisi hesabın için erişilebilir değil.";
  return cause instanceof Error ? cause.message : "İstek tamamlanamadı. Durumu kontrol edip tekrar deneyebilirsin.";
}
