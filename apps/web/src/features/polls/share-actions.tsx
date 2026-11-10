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
  const [cardBusy, setCardBusy] = useState(false);
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

  async function downloadCard() {
    if (!poll || cardBusy) return;
    setCardBusy(true);
    try {
      // Refresh first: the user may have voted since the share panel loaded.
      const current = await client.get(routeId);
      const canvas = document.createElement("canvas");
      canvas.width = 1200; canvas.height = 630;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Görsel oluşturulamadı.");
      const bg = ctx.createLinearGradient(0, 0, 1200, 630);
      bg.addColorStop(0, "#0b1311"); bg.addColorStop(1, "#263b30");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, 1200, 630);
      try {
        const art = new Image(); art.src = "/art/space/trend-galaxy.webp";
        await art.decode();
        ctx.drawImage(art, 0, 0, 1200, 630);
        const shade = ctx.createLinearGradient(0, 0, 1200, 0);
        shade.addColorStop(0, "#07100ff5"); shade.addColorStop(1, "#102019ba");
        ctx.fillStyle = shade; ctx.fillRect(0, 0, 1200, 630);
      } catch { /* The gradient keeps downloads usable if the artwork is unavailable. */ }
      ctx.strokeStyle = "#dbe99b33"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(990, 95, 190, 70, -.35, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#dbe99b"; ctx.font = "700 20px sans-serif"; ctx.fillText("KARARVER  /  BİR FİKRE KAPIL", 64, 70);
      function fit(text: string, max: number) {
        let value = text;
        while (value.length && ctx!.measureText(value).width > max) value = value.slice(0, -1);
        return value === text ? value : `${value.trimEnd()}…`;
      }
      function lines(text: string, max: number, maxLines: number) {
        const words = text.trim().split(/\s+/); const result: string[] = []; let line = "";
        for (const word of words) {
          const next = line ? `${line} ${word}` : word;
          if (line && ctx!.measureText(next).width > max) { result.push(line); line = word; } else line = next;
        }
        if (line) result.push(line);
        if (result.length > maxLines) return [...result.slice(0, maxLines - 1), fit(`${result.slice(maxLines - 1).join(" ")}`, max)];
        return result.map(value => fit(value, max));
      }
      ctx.fillStyle = "#f3f1e8"; ctx.font = "700 46px sans-serif";
      lines(current.title, 1050, 2).forEach((line, i) => ctx.fillText(line, 64, 145 + i * 58));
      // Results visible only to voters must never be exported as a public image.
      const publicResults = current.visibility === "always" && current.results.visible ? current.results : null;
      ctx.font = "600 23px sans-serif";
      current.options.slice(0, 6).forEach((option, index) => {
        const x = 64 + (index % 2) * 545; const y = 255 + Math.floor(index / 2) * 90;
        ctx.fillStyle = "#ffffff0d"; ctx.fillRect(x, y, 515, 72);
        ctx.fillStyle = "#dbe99b"; ctx.beginPath(); ctx.arc(x + 25, y + 36, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#f3f1e8";
        const result = publicResults?.options.find(item => item.id === option.id);
        ctx.fillText(fit(option.label, result ? 340 : 440), x + 43, y + 44);
        if (result) { ctx.fillStyle = "#dbe99b"; ctx.textAlign = "right"; ctx.fillText(`%${result.percent}`, x + 495, y + 44); ctx.textAlign = "left"; }
      });
      ctx.fillStyle = "#bcc9b9"; ctx.font = "19px sans-serif";
      ctx.fillText(current.kind === "discussion" ? "Fikrini paylaş · KararVer" : publicResults ? `Toplam ${publicResults.total} oy · KararVer` : "Fikrini paylaş · Sonuçlar bu görselde gösterilmez", 64, 586);
      ctx.textAlign = "right"; ctx.fillText(fit(new URL(current.canonicalPath || `/karar/${current.id}`, location.origin).href, 480), 1136, 586); ctx.textAlign = "left";
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Görsel oluşturulamadı.");
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = "kararver-paylasim.png"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      notify("Paylaşım görselin indirildi.");
    } catch (error) { notify((error as Error).message || "Görsel oluşturulamadı."); }
    finally { setCardBusy(false); }
  }

  if (!available || !poll) return null;
  return (
    <section className="kv-card kv-stack" aria-labelledby="share-title">
      <div>
        <span className="eyebrow">PAYLAŞ</span>
        <h2 id="share-title">Bu kararı başkasına da sor.</h2>
      </div>
      <div className="kv-row">
        <button className="kv-button kv-button--secondary" disabled={cardBusy} onClick={() => void downloadCard()}>{cardBusy ? "Hazırlanıyor…" : "Paylaşım görselini indir"}</button>
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
