import Link from "next/link";

export function SpaceHero() {
  return <section className="space-hero" aria-labelledby="space-hero-title">
    <img className="space-hero-backdrop" src="/art/space/earth-astronaut.webp" alt="" width="2160" height="720" fetchPriority="high" />
    <div className="space-hero-copy">
      <span className="space-eyebrow"><span aria-hidden="true" /> MERAKININ ÖTESİNİ KEŞFET</span>
      <h1 id="space-hero-title">Dünyanın<br />nabzını tut.</h1>
      <p>Güncel gelişmeler, teknoloji, ekonomi, spor ve daha fazlası için topluluğunla karar ver.</p>
      <div className="space-hero-actions">
        <Link className="kv-button" href="/kesfet">Gündem anketlerini gör <span aria-hidden="true">→</span></Link>
        <Link className="space-text-link" href="/olustur">Bir soru sor <span aria-hidden="true">↗</span></Link>
      </div>
    </div>
    <aside className="space-discovery-card" aria-label="Keşif rotan">
      <div className="space-card-orbit" aria-hidden="true"><span /><span /><span /></div>
      <span className="space-eyebrow">KEŞİF ROTAN</span>
      <h2>Bir soru.<br />Bambaşka dünyalar.</h2>
      <p>Bir fikri paylaş, farklı bakış açılarını gör. Kendi kararını ver.</p>
      <Link href="/kategoriler">Konuları keşfet <span aria-hidden="true">↗</span></Link>
    </aside>
    <div className="space-hero-topics" aria-label="Gündemdeki konuları ara">
      <span>Bir yerden başla</span>
      <Link href="/kesfet?q=teknoloji">Teknoloji</Link>
      <Link href="/kesfet?q=ekonomi">Ekonomi</Link>
      <Link href="/kesfet?q=g%C3%BCnl%C3%BCk%20ya%C5%9Fam">Günlük yaşam</Link>
    </div>
  </section>;
}
