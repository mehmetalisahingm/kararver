"use client";

import { useEffect, useRef, useState } from "react";
import { useProduct } from "../../components/product-provider";
import type { Poll } from "../../lib/model";
import { createShareLink, type ShareChannel } from "../../lib/share-client";

export function ShareActions({ routeId }: { routeId: string }) {
  const { client, notify } = useProduct();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState<ShareChannel | null>(null);
  const inFlight = useRef(false);
  const pending = useRef<{ popup: Window | null; controller: AbortController } | null>(null);
  const [fallback, setFallback] = useState<{ url: string; channel: ShareChannel; target?: string } | null>(null);

  useEffect(() => {
    let active = true;
    setPoll(null);
    setAvailable(true);
    setFallback(null);
    inFlight.current = false;
    setBusy(null);
    client.get(routeId).then((value) => {
      if (active) setPoll(value);
    }).catch(() => {
      if (active) setAvailable(false);
    });
    return () => { active = false; pending.current?.controller.abort(); pending.current?.popup?.close(); pending.current = null; };
  }, [client, routeId]);

  async function share(channel: ShareChannel) {
    if (!poll || inFlight.current) return;
    inFlight.current = true;
    setBusy(channel);
    setFallback(null);
    // Açılır pencereyi kullanıcı tıklaması içinde ayır. API beklenirse Safari'nin
    // kullanıcı etkinliği süresi dolar. Boş sekme hiçbir dış içeriği çalıştırmaz.
    let popup: Window | null = null;
    if (channel === "x" || channel === "whatsapp") {
      try { popup = window.open("about:blank", "_blank"); if (popup) popup.opener = null; } catch { /* Doğrudan bağlantı aşağıda. */ }
    }
    const controller = new AbortController();
    pending.current = { popup, controller };
    try {
      const { url } = await createShareLink(poll.id, channel, controller.signal);
      if (controller.signal.aborted) return;
      if (channel === "copy") {
        try {
          await navigator.clipboard.writeText(url);
          notify("Paylaşım bağlantısı kopyalandı.");
        } catch {
          setFallback({ url, channel });
          notify("Panoya erişilemedi. Bağlantıyı aşağıdan seçip kopyalayabilirsin.");
        }
        return;
      }
      const target = new URL(channel === "x" ? "https://twitter.com/intent/tweet" : "https://wa.me/");
      if (channel === "x") {
        target.searchParams.set("text", poll.title);
        target.searchParams.set("url", url);
      } else {
        target.searchParams.set("text", `${poll.title} ${url}`);
      }
      if (popup && !popup.closed) popup.location.replace(target.toString());
      else {
        setFallback({ url, channel, target: target.toString() });
        notify("Paylaşım penceresi açılamadı. Aşağıdaki bağlantıyla devam edebilirsin.");
      }
    } catch (error) {
      popup?.close();
      if (!controller.signal.aborted) notify((error as Error).message);
    } finally {
      if (pending.current?.controller === controller) {
        pending.current = null;
        inFlight.current = false;
        setBusy(null);
      }
    }
  }

  if (!available || !poll) return null;
  return (
    <section className="kv-card kv-stack" aria-labelledby="share-title">
      <div>
        <span className="eyebrow">PAYLAŞ</span>
        <h2 id="share-title">Bu kararı başkasına da sor.</h2>
      </div>
      <div className="kv-row">
        <button className="kv-button kv-button--secondary" disabled={busy !== null} onClick={() => void share("copy")}>
          {busy === "copy" ? "Kopyalanıyor…" : "Bağlantıyı kopyala"}
        </button>
        <button className="kv-button kv-button--ghost" disabled={busy !== null} onClick={() => void share("x")}>
          {busy === "x" ? "Açılıyor…" : "X'te paylaş"}
        </button>
        <button className="kv-button kv-button--ghost" disabled={busy !== null} onClick={() => void share("whatsapp")}>
          {busy === "whatsapp" ? "Açılıyor…" : "WhatsApp'ta paylaş"}
        </button>
      </div>
      {fallback ? <div className="kv-stack" role="status">
        {fallback.target ? <a className="kv-button kv-button--secondary" href={fallback.target} target="_blank" rel="noopener noreferrer">{fallback.channel === "x" ? "X paylaşımını aç" : "WhatsApp paylaşımını aç"}</a> : null}
        <label>Paylaşım bağlantısı<input className="kv-input" readOnly value={fallback.url} onFocus={e => e.currentTarget.select()} /></label>
      </div> : null}
    </section>
  );
}
