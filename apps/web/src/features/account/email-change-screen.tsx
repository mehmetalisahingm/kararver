"use client";
// E-posta değişimi bağlantı sayfası (#181): e-postadaki bağlantıyla açılır (/hesap/eposta-degisimi#token=…&step=…).
// Sayfa açılışı bir şey yapmaz; onay/ret açık bir tıklamayla gider. Token bellekte tutulur ve adres çubuğundan temizlenir.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useProduct } from "../../components/product-provider";
import { ApiClient } from "../../lib/api-client";
import { describeLink, emailChangeError, parseLink, resultMessage, type EmailChangeLink } from "./email-change-model";

type Phase = "idle" | "busy" | "done" | "failed";

export function EmailChangeScreen() {
  const { client, demo } = useProduct();
  const [link, setLink] = useState<EmailChangeLink | null>(null);
  const [checked, setChecked] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [retryable, setRetryable] = useState(false);

  useEffect(() => {
    const parsed = parseLink(window.location.hash);
    setLink((current) => parsed ?? current);
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname);
    setChecked(true);
  }, []);

  async function submit() {
    if (!link || !(client instanceof ApiClient) || phase === "busy") return;
    setPhase("busy");
    try {
      if (link.action === "deny") {
        await client.denyEmailChange(link.token);
        setMessage(resultMessage("denied", link.step));
      } else {
        const result = await client.confirmEmailChange(link.token);
        setMessage(resultMessage(result.status, result.step));
      }
      setPhase("done");
    } catch (cause) {
      const described = emailChangeError(cause);
      setMessage(described.message);
      setRetryable(described.retryable);
      setPhase("failed");
    }
  }

  const heading = <h1>E-posta değişimi</h1>;
  if (demo) return <section className="auth-card kv-card screen-stack">{heading}<p className="kv-muted">Bu özellik demo modunda yoktur.</p></section>;
  if (!checked) return <section className="auth-card kv-card screen-stack" aria-busy="true">{heading}<p className="kv-muted" role="status">Yükleniyor…</p></section>;
  if (!link) {
    return (
      <section className="auth-card kv-card screen-stack">
        {heading}
        <p>Bu sayfa e-postana gönderilen bağlantıyla açılır. Bağlantı bulunamadı veya bu sekmede artık geçerli değil.</p>
        <Link href="/hesap">Hesabıma git</Link>
      </section>
    );
  }
  const info = describeLink(link);
  return (
    <section className="auth-card kv-card screen-stack">
      <h1>{info.title}</h1>
      {phase === "done" ? (
        <>
          <p role="status">{message}</p>
          <Link className="kv-button" href="/giris">Giriş yap</Link>
        </>
      ) : (
        <>
          <p>{info.body}</p>
          {phase === "failed" ? <p role="alert">{message}</p> : null}
          {phase !== "failed" || retryable ? (
            <button type="button" className={info.deny ? "kv-button kv-button--danger" : "kv-button"} disabled={phase === "busy"} aria-busy={phase === "busy"} onClick={() => void submit()}>
              {phase === "busy" ? "Gönderiliyor…" : phase === "failed" ? "Tekrar dene" : info.button}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
