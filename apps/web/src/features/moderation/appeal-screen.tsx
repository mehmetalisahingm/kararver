"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Id, MyModerationAppealView } from "@kararver/contracts";
import { useProduct } from "../../components/product-provider";
import { ErrorMessage, Loading } from "../../components/fields";
import { ApiClient } from "../../lib/api-client";
import { UiError } from "../../lib/model";

type Appeal = ReturnType<typeof MyModerationAppealView.parse>;
type Outcome = Awaited<ReturnType<ApiClient["appealOutcome"]>>;
const rejectionMessages = { SENSITIVE_DATA_REQUEST: "İçerik hassas kişisel veri talebi içeriyor.", CONTENT_POLICY_VIOLATION: "İçerik yayın kurallarına uygun bulunmadı.", ORIGINAL_DECISION_UPHELD: "İnceleme sonucunda ilk karar geçerli bulundu." } as const;
const date = (value: string) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(value));

export function AppealScreen({ id }: { id: string }) {
  const { user } = useProduct();
  // A change of viewer or rejection must unmount private local state
  // synchronously, before effects or a delayed previous response can run.
  return <AppealScreenScope key={JSON.stringify([user?.id ?? null, id])} id={id} />;
}

function AppealScreenScope({ id }: { id: string }) {
  const { client, user } = useProduct();
  const [appeal, setAppeal] = useState<Appeal | null>(null);
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [outcomeError, setOutcomeError] = useState(false);
  const [outcomeLoading, setOutcomeLoading] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [attempt, retry] = useState(0);
  const submitting = useRef(false);
  const submission = useRef<AbortController | null>(null);
  useEffect(() => () => submission.current?.abort(), []);
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

  useEffect(() => {
    const controller = new AbortController();
    setOutcome(null); setOutcomeError(false); setOutcomeLoading(false);
    if (!real || !user || appeal?.status !== "FILED") return () => controller.abort();
    setOutcomeLoading(true);
    real.appealOutcome(id, controller.signal)
      .then(result => { if (!controller.signal.aborted) setOutcome(result); })
      .catch(() => { if (!controller.signal.aborted) setOutcomeError(true); })
      .finally(() => { if (!controller.signal.aborted) setOutcomeLoading(false); });
    return () => controller.abort();
  }, [real, user?.id, appeal, id, attempt]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!real || !appeal || appeal.status !== "OPEN" || submitting.current) return;
    if (reason.trim().length < 10) { setError("İtiraz gerekçesi en az 10 karakter olmalı."); return; }
    submitting.current = true; setBusy(true); setError("");
    const controller = new AbortController();
    submission.current = controller;
    try {
      const result = await real.fileModerationAppeal(id, reason.trim(), controller.signal);
      if (!controller.signal.aborted) setAppeal(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError(message(cause));
    } finally {
      if (submission.current === controller) submission.current = null;
      if (!controller.signal.aborted) { submitting.current = false; setBusy(false); }
    }
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
          {appeal.status === "FILED" && <section aria-label="İtiraz sonucu" className="screen-stack">
            {outcomeLoading ? <Loading label="İtiraz sonucu kontrol ediliyor…" />
              : outcomeError ? <p role="alert">İtiraz sonucu doğrulanamadı. Durumu tekrar kontrol et.</p>
              : outcome?.outcome === "ACCEPTED" ? <><p role="status">İtirazın kabul edildi. Bu karar için yeniden yayın ücreti alınmadı.</p><p>Karar tarihi: <time dateTime={outcome.resolvedAt}>{date(outcome.resolvedAt)}</time>. Bu makbuz güncel yayın durumunu garanti etmez.</p></>
              : outcome?.outcome === "REJECTED" ? <><p role="status">İtirazın reddedildi.</p><p>{rejectionMessages[outcome.reason]}</p><p>Karar tarihi: <time dateTime={outcome.resolvedAt}>{date(outcome.resolvedAt)}</time></p></>
              : <p role="status">Henüz doğrulanmış sonuç makbuzu bulunmuyor.</p>}
          </section>}
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
