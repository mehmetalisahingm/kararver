"use client";

// Rapor penceresi (KV-24): anket veya yoruma neden seçerek şikayet. Rapor içeriği silmez veya gizlemez; moderasyon
// kuyruğuna düşer. Aynı içeriği tekrar raporlamak yeni kayıt açmaz (sunucu aynı rapor kimliğini döner).
import { useEffect, useId, useRef, useState } from "react";
import { ErrorMessage } from "../../components/fields";
import { useProduct } from "../../components/product-provider";
import { UiError } from "../../lib/model.ts";
import type { ReportReasonId, ReportTarget } from "./community-client.ts";

export const reportReasons: [ReportReasonId, string][] = [
  ["SPAM", "Spam veya reklam"],
  ["MISLEADING", "Yanıltıcı bilgi"],
  ["INAPPROPRIATE", "Uygunsuz içerik"],
  ["HARASSMENT", "Taciz veya hakaret"],
  ["HATE", "Nefret söylemi"],
  ["PERSONAL_INFO", "Kişisel bilgi paylaşımı"],
  ["COPYRIGHT", "Telif hakkı"],
  ["OTHER", "Diğer"],
];

export function ReportButton({ target, label }: { target: ReportTarget; label: string }) {
  const { client, requireUser, notify } = useProduct();
  const api = client.reports;
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReasonId>("SPAM");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  // Demo adapter'da rapor yoktur: düğme hiç görünmez (ölü düğme göstermeyiz).
  if (!api) return null;

  function show() {
    if (!requireUser(typeof window === "undefined" ? "/" : window.location.pathname)) return;
    setReason("SPAM");
    setNote("");
    setError("");
    setOpen(true);
  }
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api!.create(target, reason, note);
      notify("Raporun alındı. Moderatörler inceleyecek.");
      close();
    } catch (cause) {
      setError(cause instanceof UiError ? cause.message : "Rapor gönderilemedi. Tekrar deneyebilirsin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button ref={trigger} type="button" className="kv-button kv-button--ghost" onClick={show} aria-label={label}>
        Raporla
      </button>
      <dialog ref={dialog} className="kv-dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (!busy) close(); }}>
        <form className="kv-stack" onSubmit={submit}>
          <h2 id={titleId}>İçeriği raporla</h2>
          <p className="kv-muted">Raporun içeriği silmez; moderatörler inceler. Aynı içeriği tekrar raporlaman gerekmez.</p>
          <label>
            Neden
            <select className="kv-input" value={reason} onChange={(event) => setReason(event.target.value as ReportReasonId)}>
              {reportReasons.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </label>
          <label>
            Not (isteğe bağlı)
            <textarea className="kv-input" rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <ErrorMessage message={error} />
          <div className="kv-row">
            <button type="button" className="kv-button kv-button--secondary" onClick={close} disabled={busy}>Vazgeç</button>
            <button type="submit" className="kv-button" disabled={busy}>{busy ? "Gönderiliyor…" : "Raporu gönder"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
