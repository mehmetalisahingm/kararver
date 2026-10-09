"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useProduct } from "../../components/product-provider";
import type { CommunityRequestItem } from "./community-client.ts";

const LABELS = {
  PENDING: "Yönetici onayı bekliyor",
  APPROVED: "Onaylandı",
  REJECTED: "Reddedildi",
  CLOSED: "7 günde 10 üyeye ulaşamadı; kapatıldı",
} as const;

export function CommunityRequestPanel() {
  const { client, user } = useProduct();
  const api = client.community;
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [requests, setRequests] = useState<CommunityRequestItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!api || !user) return;
    let active = true;
    Promise.all([api.myRequests(), api.categories()])
      .then(([mine, categories]) => {
        if (!active) return;
        setRequests(mine);
        setCategories(categories.map((c) => ({ id: c.id, name: c.name })));
      })
      .catch(() => { if (active) setError("Başvurular şu an yüklenemedi; daha sonra yeniden dene."); });
    return () => { active = false; };
  }, [api, client, user]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || busy) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const created = await api.createRequest({
        name: name.trim(), slug: slug.trim().toLowerCase(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(categoryId ? { categoryId } : {}),
      });
      setRequests((previous) => [created, ...previous.filter((r) => r.id !== created.id)]);
      setNotice("Başvurun alındı. Yönetici onayından sonra topluluk açılacak.");
      setName(""); setSlug(""); setDescription(""); setCategoryId("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Başvurun gönderilemedi.");
    } finally { setBusy(false); }
  }

  if (!api) return null;
  return (
    <section className="kv-card screen-stack" aria-labelledby="community-request-heading">
      <div>
        <span className="eyebrow">TOPLULUK ÖNER</span>
        <h2 id="community-request-heading">Kendi topluluğunu oluştur</h2>
        <p className="kv-muted">Önerin önce yönetici onayına gider. Onaylanan topluluk 7 günde 10 üyeye ulaşmazsa otomatik kapanır.</p>
      </div>
      {!user ? <p>Başvuru göndermek için <Link href="/giris?returnTo=%2Ftopluluklar">giriş yap</Link>.</p> : (
        <>
          <form className="screen-stack" onSubmit={(event) => void submit(event)}>
            <label>Topluluk adı
              <input className="kv-input" required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>Adres (küçük harf, rakam ve tire)
              <input className="kv-input" required minLength={2} maxLength={60} pattern="[a-z0-9-]{2,60}" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} />
            </label>
            <label>Açıklama
              <textarea className="kv-input" rows={3} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
            <label>Kategori
              <select className="kv-input" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                <option value="">Kategori seçilmedi</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            {error ? <p role="alert">{error}</p> : null}
            {notice ? <p role="status">{notice}</p> : null}
            <button className="kv-button" disabled={busy}>{busy ? "Gönderiliyor…" : "Topluluk talebi gönder"}</button>
          </form>
          <div className="screen-stack">
            <h3>Başvurularım</h3>
            {!requests.length ? <p className="kv-muted">Henüz başvurun yok.</p> : null}
            {requests.map((request) => (
              <article className="kv-card kv-stack" key={request.id}>
                <div className="kv-row kv-between">
                  <strong>{request.name}</strong>
                  <span className="kv-badge kv-badge--neutral">{LABELS[request.status]}</span>
                </div>
                <p className="kv-muted">/{request.slug} · {request.memberCount} üye</p>
                {request.status === "APPROVED" && request.approvalDeadline ?
                  <p>Son tarih: {new Date(request.approvalDeadline).toLocaleDateString("tr-TR")} · <Link href={`/topluluk/${request.slug}`}>Topluluğa git</Link></p> : null}
                {request.status === "REJECTED" && request.rejectionReason ?
                  <p>Gerekçe: {request.rejectionReason}</p> : null}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
