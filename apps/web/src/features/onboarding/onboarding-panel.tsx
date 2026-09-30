"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useProduct } from "../../components/product-provider";
import { categories as demoCategoryNames } from "../../lib/model";

type CategoryItem = { id: string; name: string; description?: string | null };
type CommunityItem = { id: string; slug: string; name: string; description?: string | null; memberCount?: number };

type ApiEnvelope<T> = { data: T };
type ApiPage<T> = { data: T[] };

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}/v1${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message ?? "İşlem tamamlanamadı. Tekrar deneyebilirsin.";
    throw new Error(message);
  }
  return payload as T;
}

export function OnboardingPanel() {
  const { demo, user, notify } = useProduct();
  const [items, setItems] = useState<CategoryItem[]>([]);
  const [communities, setCommunities] = useState<CommunityItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    setSaved(false);

    if (demo) {
      const demoItems = demoCategoryNames.map((name, index) => ({ id: `demo-${index}`, name }));
      const demoCommunities: CommunityItem[] = [
        { id: "demo-tech", slug: "teknoloji", name: "Teknoloji", description: "Cihaz, yazılım ve dijital yaşam kararları." },
        { id: "demo-uni", slug: "universite", name: "Üniversite", description: "Ders, kampüs ve öğrenci hayatı kararları." },
        { id: "demo-auto", slug: "otomobil", name: "Otomobil", description: "Araç, bakım ve satın alma deneyimleri." },
      ];
      setItems(demoItems);
      setCommunities(demoCommunities);
      setLoading(false);
      return;
    }

    Promise.all([
      api<ApiEnvelope<CategoryItem[]>>("/categories"),
      api<ApiEnvelope<{ categoryIds: string[] }>>("/me/interests"),
      api<ApiPage<CommunityItem>>("/communities?limit=3"),
    ])
      .then(([categoryResponse, interestResponse, communityResponse]) => {
        if (!active) return;
        setItems(categoryResponse.data);
        setSelected(interestResponse.data.categoryIds);
        setCommunities(communityResponse.data);
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [demo, user, attempt]);

  function toggle(id: string) {
    setSaved(false);
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  async function save() {
    if (!user || saving || selected.length === 0) return;
    setSaving(true);
    setError("");
    try {
      if (!demo) {
        const response = await api<ApiEnvelope<{ categoryIds: string[] }>>("/me/interests", {
          method: "PUT",
          body: JSON.stringify({ categoryIds: selected }),
        });
        setSelected(response.data.categoryIds);
      }
      setSaved(true);
      notify("İlgi alanların kaydedildi.");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function skip() {
    setSaved(true);
    notify("İlgi seçimini atladın. Akışın farklı alanlardan başlayacak.");
  }

  if (!user) {
    return (
      <section className="kv-card screen-stack">
        <span className="eyebrow">İLGİ ALANLARI</span>
        <h1>Akışını kişiselleştirmek için giriş yap.</h1>
        <p className="kv-muted">Seçim zorunlu değil. Girişten sonra kategorilerini seçebilir veya bu adımı atlayabilirsin.</p>
        <Link className="kv-button" href="/giris?returnTo=%2Filgi-alanlari">Giriş yap</Link>
        <Link href="/">Şimdilik gezin</Link>
      </section>
    );
  }

  return (
    <section className="screen-stack" aria-labelledby="onboarding-title">
      <div className="kv-card kv-stack">
        <span className="eyebrow">AKIŞINI ŞEKİLLENDİR</span>
        <h1 id="onboarding-title">Hangi konular ilgini çekiyor?</h1>
        <p className="kv-muted">
          İstersen birkaç kategori seç. Hiç seçim yapmazsan KararVer başlangıçta farklı alanlardan dengeli bir akış gösterir.
          Tercihlerini Hesabım ekranından daha sonra değiştirebilirsin.
        </p>

        {loading && <p role="status">İlgi alanların yükleniyor…</p>}
        {error && (
          <div className="kv-stack" role="alert">
            <p>{error}</p>
            <button className="kv-button kv-button--secondary" onClick={() => setAttempt((n) => n + 1)}>Tekrar dene</button>
          </div>
        )}

        {!loading && !error && (
          <div className="kv-stack">
            <div aria-label="İlgi kategorileri">
              {items.map((item) => {
                const active = selected.includes(item.id);
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={active ? "kv-button" : "kv-button kv-button--ghost"}
                    aria-pressed={active}
                    onClick={() => toggle(item.id)}
                  >
                    {item.name}
                  </button>
                );
              })}
            </div>
            <p className="kv-muted">{selected.length ? `${selected.length} kategori seçili.` : "Henüz kategori seçmedin."}</p>
            <div>
              <button className="kv-button" disabled={saving || selected.length === 0} onClick={() => void save()}>
                {saving ? "Kaydediliyor…" : "Seçimlerimi kaydet"}
              </button>{" "}
              <button className="kv-button kv-button--secondary" disabled={saving} onClick={skip}>
                Şimdilik atla
              </button>
            </div>
            {saved && <p role="status">Tercihin işlendi.</p>}
          </div>
        )}
      </div>

      <div className="kv-card kv-stack">
        <span className="eyebrow">TOPLULUK ÖNERİLERİ</span>
        <h2>İstersen topluluklara göz at.</h2>
        <p className="kv-muted">Buradaki önerilere bakmak seni otomatik olarak hiçbir topluluğa üye yapmaz.</p>
        {communities.length === 0 ? (
          <p className="kv-muted">Şu an gösterilecek açık topluluk yok.</p>
        ) : (
          communities.map((community) => (
            <div key={community.id} className="kv-stack">
              <strong>{community.name}</strong>
              {community.description && <span className="kv-muted">{community.description}</span>}
            </div>
          ))
        )}
        <Link href="/kesfet">Keşfet ekranına git</Link>
      </div>
    </section>
  );
}
