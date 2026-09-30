"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useProduct } from "../../components/product-provider";
import { ApiClient } from "../../lib/api-client";
import { categories as demoCategoryNames } from "../../lib/model";

type CategoryItem = { id: string; name: string; description?: string | null };
type CommunityItem = { id: string; slug: string; name: string; description?: string | null; memberCount?: number };

const MAX_INTERESTS = 20;

export function OnboardingPanel() {
  const { demo, user, notify, client } = useProduct();
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

    if (!(client instanceof ApiClient)) {
      setError("API istemcisi hazır değil.");
      setLoading(false);
      return;
    }

    Promise.all([
      client.publicationCategories(),
      client.interests(),
      client.onboardingCommunities(3),
    ])
      .then(([categoryResponse, interestIds, communityResponse]) => {
        if (!active) return;
        const activeIds = new Set(categoryResponse.map((category) => category.id));
        setItems(categoryResponse);
        // Yönetici daha önce seçilmiş bir kategoriyi pasife aldıysa görünmez ID kayda geri gönderilmez.
        setSelected(interestIds.filter((id) => activeIds.has(id)));
        setCommunities(communityResponse);
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
  }, [client, demo, user, attempt]);

  function toggle(id: string) {
    setSaved(false);
    if (!selected.includes(id) && selected.length >= MAX_INTERESTS) {
      setError(`En fazla ${MAX_INTERESTS} kategori seçebilirsin.`);
      return;
    }
    setError("");
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  async function save() {
    if (!user || saving) return;
    setSaving(true);
    setError("");
    try {
      if (!demo) {
        if (!(client instanceof ApiClient)) throw new Error("API istemcisi hazır değil.");
        setSelected(await client.saveInterests(selected));
      }
      setSaved(true);
      notify(selected.length ? "İlgi alanların kaydedildi." : "İlgi alanların temizlendi.");
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
                const disabled = !active && selected.length >= MAX_INTERESTS;
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={active ? "kv-button" : "kv-button kv-button--ghost"}
                    aria-pressed={active}
                    disabled={disabled}
                    title={disabled ? `En fazla ${MAX_INTERESTS} kategori seçebilirsin.` : undefined}
                    onClick={() => toggle(item.id)}
                  >
                    {item.name}
                  </button>
                );
              })}
            </div>
            <p className="kv-muted">
              {selected.length ? `${selected.length}/${MAX_INTERESTS} kategori seçili.` : "Henüz kategori seçmedin."}
            </p>
            <div>
              <button className="kv-button" disabled={saving} onClick={() => void save()}>
                {saving ? "Kaydediliyor…" : selected.length ? "Seçimlerimi kaydet" : "Tercihlerimi temizle"}
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
