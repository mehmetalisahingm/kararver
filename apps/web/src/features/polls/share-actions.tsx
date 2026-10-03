"use client";

import { useState } from "react";
import { useProduct } from "../../components/product-provider";
import { createShareLink, type ShareChannel } from "../../lib/share-client";

export function ShareActions({ routeId }: { routeId: string }) {
  const { client, notify } = useProduct();
  const [busy, setBusy] = useState<ShareChannel | null>(null);

  async function share(channel: ShareChannel) {
    if (busy) return;
    setBusy(channel);
    try {
      const poll = await client.get(routeId);
      const { url } = await createShareLink(poll.id, channel);
      if (channel === "copy") {
        await navigator.clipboard.writeText(url);
        notify("Paylaşım bağlantısı kopyalandı.");
        return;
      }
      if (channel === "x") {
        const target = new URL("https://twitter.com/intent/tweet");
        target.searchParams.set("text", poll.title);
        target.searchParams.set("url", url);
        window.open(target.toString(), "_blank", "noopener,noreferrer");
        return;
      }
      if (channel === "whatsapp") {
        const target = new URL("https://wa.me/");
        target.searchParams.set("text", `${poll.title} ${url}`);
        window.open(target.toString(), "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

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
    </section>
  );
}
