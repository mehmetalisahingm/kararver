"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useProduct } from "../../components/product-provider";
import { ErrorMessage } from "../../components/fields";
import { ApiClient } from "../../lib/api-client";
import { safeReturnTo } from "../../lib/model";

export function AdultDeclarationScreen() {
  const { client, user, syncUser } = useProduct();
  const router = useRouter();
  const params = useSearchParams();
  const target = safeReturnTo(params.get("returnTo") || "/");
  const destination = target.startsWith("/hesap/yas-beyani") ? "/" : target;
  const self = `/hesap/yas-beyani?returnTo=${encodeURIComponent(destination)}`;
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const refresh = useCallback(async () => {
    if (!(client instanceof ApiClient) || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await client.restore(); syncUser(); }
    catch (cause) { setError((cause as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }, [client, syncUser]);

  // Another tab can confirm the declaration or expire/logout the session.
  // Re-read the server; no personal age state is stored in browser storage.
  useEffect(() => {
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [refresh]);
  useEffect(() => { heading.current?.focus(); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!checked || lock.current || !(client instanceof ApiClient)) return;
    lock.current = true; setBusy(true); setError("");
    try {
      await client.confirmAdultDeclaration(); syncUser();
      router.push(destination);
    } catch (cause) { syncUser(); setError((cause as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }

  return <section className="kv-card screen-stack" aria-labelledby="adult-title">
    <h1 id="adult-title" ref={heading} tabIndex={-1}>18+ yaş beyanı</h1>
    <p>KararVer'de katılım 18 yaş ve üzeri içindir. Bu bir öz beyandır; kimlik veya gerçek yaş doğrulaması değildir.</p>
    <ErrorMessage message={error} />
    {!user ? <><p role="status">Oturumun açık değil. Beyan durumunu görmek için yeniden giriş yap.</p><Link className="kv-button" href={`/giris?returnTo=${encodeURIComponent(self)}`}>Yeniden giriş yap</Link></>
      : user.adultDeclarationRequired ? <form className="screen-stack" onSubmit={submit} aria-busy={busy}>
        <p>Oy, yorum, görsel yükleme ve anket oluşturma için beyan gerekiyor. Beyan vermeden kamuya açık içerikleri okuyabilir ve hesap haklarına erişebilirsin.</p>
        <label className="kv-check-row"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} disabled={busy} required />18 yaşımı doldurduğumu beyan ediyorum.</label>
        <p className="kv-help">Bu seçim kullanım koşulları kabulü veya isteğe bağlı veri işleme rızası değildir. 18 yaşını doldurmadıysan işaretleme.</p>
        <button className="kv-button" disabled={!checked || busy}>{busy ? "Kaydediliyor…" : "Beyanı kaydet ve devam et"}</button>
        <button className="kv-button kv-button--secondary" type="button" disabled={busy} onClick={() => { void refresh(); }}>Durumu tekrar kontrol et</button>
        <Link href="/kesfet">Beyan vermeden içerikleri keşfet</Link>
      </form> : <><p role="status">Hesabın için yeni bir yaş beyanı gerekmiyor.</p><Link className="kv-button" href={destination}>İşlemime dön</Link></>}
    <p role="status" aria-live="polite">{busy ? "Sunucu yanıtı bekleniyor; işlemi tekrar göndermene gerek yok." : ""}</p>
  </section>;
}
