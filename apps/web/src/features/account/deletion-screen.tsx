"use client";
// Hesap silme bağlantı sayfası (#181): e-postadaki bağlantıyla açılır (/hesap/silme-onayi#token=…&action=confirm|cancel).
// Sayfa açılışı bir şey yapmaz; silme/iptal açık bir tıklamayla gider. Token bellekte tutulur ve adres çubuğundan temizlenir.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useProduct } from "../../components/product-provider";
import { ApiClient } from "../../lib/api-client";
import { deletionError, deletionResultMessage, describeDeletionLink, parseDeletionLink, type DeletionLink } from "./deletion-model";

type Phase = "idle" | "busy" | "done" | "failed";

export function DeletionScreen() {
  const { client, demo } = useProduct();
  const [link, setLink] = useState<DeletionLink | null>(null);
  const [checked, setChecked] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [retryable, setRetryable] = useState(false);

  useEffect(() => {
    const parsed = parseDeletionLink(window.location.hash);
    setLink((current) => parsed ?? current);
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname);
    setChecked(true);
  }, []);

  async function submit() {
    if (!link || !(client instanceof ApiClient) || phase === "busy") return;
    setPhase("busy");
    try {
      if (link.action === "confirm") {
        const result = await client.confirmDeletion(link.token);
        setMessage(deletionResultMessage(result.status));
      } else {
        await client.cancelDeletionByLink(link.token);
        setMessage(deletionResultMessage("cancelled"));
      }
      setPhase("done");
    } catch (cause) {
      const described = deletionError(cause);
      setMessage(described.message);
      setRetryable(described.retryable);
      setPhase("failed");
    }
  }

  const heading = <h1>Hesap silme</h1>;
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
  const info = describeDeletionLink(link);
  return (
    <section className="auth-card kv-card screen-stack">
      <h1>{info.title}</h1>
      {phase === "done" ? (
        <>
          <p role="status">{message}</p>
          <Link className="kv-button" href={link.action === "confirm" ? "/" : "/giris"}>{link.action === "confirm" ? "Ana sayfaya git" : "Giriş yap"}</Link>
        </>
      ) : (
        <>
          <p>{info.body}</p>
          {phase === "failed" ? <p role="alert">{message}</p> : null}
          {phase !== "failed" || retryable ? (
            <button type="button" className={info.danger ? "kv-button kv-button--danger" : "kv-button"} disabled={phase === "busy"} aria-busy={phase === "busy"} onClick={() => void submit()}>
              {phase === "busy" ? "Gönderiliyor…" : phase === "failed" ? "Tekrar dene" : info.button}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
