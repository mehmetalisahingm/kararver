"use client";

import type { CSSProperties } from "react";
import { useProduct } from "./product-provider";
import { useSceneMotion } from "./scene-motion";

type Art = "signal" | "draft" | "atlas" | "identity" | "security";
type Atmosphere = { art: Art; index: string; title: string; line: string; compact?: boolean };

export function studioAtmosphere(path: string): Atmosphere {
  if (path === "/bildirimler") return { art: "signal", index: "İLETİŞİM / BİLDİRİMLER", title: "Aynı frekansta.", line: "Sana ulaşan fikirler, tek bir yerde." };
  if (path === "/olustur") return { art: "draft", index: "FİKİR ATÖLYESİ / YENİ BİR SORU", title: "Aklındaki dışarı çıksın.", line: "Bir cümleyle başlar. Gerisi birlikte gelir." };
  if (path === "/kategoriler" || path.startsWith("/kategori/")) return { art: "atlas", index: "MERAK ATLASI / KONULAR", title: "Bir yere takıl.", line: "Bildiğin bir konuya ya da hiç bilmediğin bir şeye." };
  if (path === "/yukselenler") return { art: "atlas", index: "GÜNDEM / FARKLI YÖRÜNGELER", title: "Fikirler yerinde durmaz.", line: "Bugünün konuşmaları, yeni bakış açıları." };
  if (path.startsWith("/admin")) return { art: "security", index: "YÖNETİM / KONTROL ODASI", title: "Bütün parçalar, bir arada.", line: "İçerik, topluluk ve sistem yönetimi.", compact: true };
  if (path.startsWith("/hesap/guvenlik") || path.includes("silme-onayi") || path.includes("sifre")) return { art: "security", index: "GÜVENLİK / KİŞİSEL ALAN", title: "Sınırlarını sen belirlersin.", line: "Hesabın ve erişimin, senin kontrolünde.", compact: true };
  if (path === "/hesap" || path.startsWith("/profil/")) return { art: "identity", index: "KİŞİSEL YÖRÜNGE / PROFİL", title: "Burada bir yerin var.", line: "Paylaştıkların, seçimlerin ve sana ait olanlar.", compact: true };
  if (path.startsWith("/karar/")) return { art: "atlas", index: "KARAR ALANI / FARKLI BAKIŞLAR", title: "Sence nasıl?", line: "Bir soru etrafında buluşuyoruz.", compact: true };
  if (path.startsWith("/topluluk/")) return { art: "signal", index: "ORTAK YÖRÜNGE / TOPLULUK", title: "Birlikte başka.", line: "Aynı merakın peşindeki insanlarla.", compact: true };
  if (path === "/giris" || path === "/kayit" || path === "/dogrula") return { art: "identity", index: "TOPLULUĞA KATIL / BİR BAŞLANGIÇ", title: "Sohbette yerin hazır.", line: "Fikrini de yanına al.", compact: true };
  if (path === "/ilgi-alanlari") return { art: "atlas", index: "KEŞİF AYARLARI / İLGİ ALANLARI", title: "Merakını takip et.", line: "Akışının yönünü, ilgilerin belirlesin." };
  if (path === "/veri-indir") return { art: "security", index: "VERİLERİN / KİŞİSEL ARŞİV", title: "Sana ait olan sende kalsın.", line: "Verilerinle ilgili işlemleri buradan yönet.", compact: true };
  if (path.includes("eposta")) return { art: "signal", index: "HESAP / BAĞLANTI", title: "Bağlantıyı koruyalım.", line: "Hesabına ulaşan yolları güncel tut.", compact: true };
  return { art: "atlas", index: "KARARVER / YENİ BİR BAKIŞ", title: "Bir yol daha var.", line: "Birlikte keşfetmeye devam.", compact: true };
}

function StudioArtwork({ art, charged, ink }: { art: Art; charged: boolean; ink: number }) {
  const source = art === "signal" ? "/art/studio/satellite-v4.webp" : art === "draft" ? "/art/studio/drafting-v4.webp" : art === "identity" || art === "security" ? "/art/space/landed-astronaut-v3.webp" : "/art/studio/armillary-v4.webp";
  return <div className={"studio-art studio-art--" + art} aria-hidden="true" data-charged={charged} style={{ "--draft-ink": ink } as CSSProperties}>
    <div className="studio-art-grid" />
    <div className="studio-orbit-frame"><svg className="studio-art-orbits" viewBox="0 0 420 280" fill="none"><ellipse cx="210" cy="140" rx="185" ry="89" transform="rotate(-24 210 140)" /><ellipse cx="210" cy="140" rx="170" ry="102" transform="rotate(34 210 140)" /><path d="M210 12v20m0 216v20M15 140h20m350 0h20" /><circle cx="50" cy="185" r="4" /></svg></div>
    {art === "signal" && <div className="studio-signal-rings"><i /><i /><i /></div>}
    {art === "security" && <div className="studio-security-reticle"><span /><span /></div>}
    <img className="studio-object" src={source} alt="" width="800" height="800" />
    {art === "draft" && <div className="studio-draft-ink"><i /><i /><i /></div>}
    <div className="studio-art-coordinate"><span>↗</span><span>{art === "signal" ? "BAĞLANTI" : art === "draft" ? "BİR FİKİR" : art === "security" ? "KİŞİSEL ALAN" : art === "identity" ? "SENİN YÖRÜNGEN" : "KEŞİF"}</span></div>
  </div>;
}

export function StudioAtmosphere({ pathname, unread }: { pathname: string; unread: number }) {
  const config = studioAtmosphere(pathname);
  const { paused, reduced, toggle } = useSceneMotion();
  const { draft, user } = useProduct();
  const staticArt = pathname.startsWith("/admin");
  const still = paused || reduced || staticArt;
  const ink = pathname === "/olustur" ? Math.min(1, draft.title.trim().length / 100) : 0;
  return <section className="studio-atmosphere" data-compact={config.compact ?? false} data-still={still} aria-label={config.index}>
    <div className="studio-atmosphere-copy"><span className="studio-eyebrow">{config.index}</span><p className="studio-atmosphere-title">{config.title}</p><p className="studio-atmosphere-line">{pathname === "/bildirimler" && user && unread > 0 ? unread + " okunmamış bildirim seni bekliyor." : config.line}</p></div>
    <StudioArtwork art={config.art} charged={pathname === "/bildirimler" && unread > 0} ink={ink} />
    {!staticArt && <button type="button" className="studio-motion" onClick={toggle} disabled={reduced} aria-pressed={paused} aria-label={reduced ? "Azaltılmış hareket etkin" : paused ? "Animasyonu başlat" : "Animasyonu durdur"}><span aria-hidden="true">{still ? "▷" : "Ⅱ"}</span><span>{reduced ? "Hareket azaltıldı" : paused ? "Devam et" : "Hareketi durdur"}</span></button>}
  </section>;
}
