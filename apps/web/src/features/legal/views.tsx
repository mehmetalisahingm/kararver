import type { ReactNode } from "react";
import { legalLinks, type LegalBundle, type LegalLink, type legalRevision } from "./model";

export function PublicLegalShell({ children }: { children: ReactNode }) {
  return <div className="legal-public">
    <a tabIndex={0} className="legal-skip" href="#legal-main">İçeriğe geç</a>
    <header><a tabIndex={0} href="/">Kararver</a><a tabIndex={0} href="/">Ana sayfaya dön</a></header>
    <main id="legal-main" tabIndex={-1}>{children}</main>
  </div>;
}

export function LegalFooter({ links }: { links: readonly LegalLink[] }) {
  if (!links.length) return null;
  return <footer className="legal-footer"><nav aria-label="Yasal bilgiler">
    {links.map(link => <a tabIndex={0} key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">{link.label}<span className="legal-sr-only"> (yeni sekmede açılır)</span></a>)}
  </nav></footer>;
}

export function RegistrationLegalNotice({ links }: { links: readonly LegalLink[] }) {
  if (!links.length) return null;
  return <aside className="legal-registration" aria-label="Kayıt öncesi bilgilendirme">
    <p>Hesap oluşturmadan önce verilerinin işlenmesi ve hizmet hakkında bilgi al.</p>
    <nav aria-label="Kayıt bilgilendirme metinleri">{links.filter(link => link.kind === "privacy" || link.kind === "terms").map(link =>
      <a tabIndex={0} key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">{link.label}<span className="legal-sr-only"> (yeni sekmede açılır)</span></a>)}</nav>
  </aside>;
}

export function LegalIndex({ bundle }: { bundle: LegalBundle }) {
  return <section><h1>Yasal bilgiler</h1>
    <p>{bundle.operatorName}</p>
    <p><a tabIndex={0} href={`mailto:${bundle.contactEmail}`}>{bundle.contactEmail}</a></p>
    <ul>{legalLinks(bundle).map(link => <li key={link.href}><a tabIndex={0} href={link.href}>{link.label}</a> · Sürüm {link.version}</li>)}</ul>
  </section>;
}

export function LegalDocumentView({ bundle, resolved }: { bundle: LegalBundle; resolved: NonNullable<ReturnType<typeof legalRevision>> }) {
  const { document, revision, current } = resolved;
  return <article>
    <a tabIndex={0} href="/yasal">Tüm yasal bilgiler</a>
    <h1>{revision.title}</h1>
    <p>Sürüm {revision.version} · Yayın: <time dateTime={revision.publishedOn}>{revision.publishedOn}</time></p>
    {!current && <p className="legal-archive">Bu önceki sürümdür. <a tabIndex={0} href={`/yasal/${document.slug}`}>Güncel metni oku</a></p>}
    {revision.sections.map((section, index) => <section key={index}><h2>{section.heading}</h2>{section.paragraphs.map((paragraph, n) => <p key={n}>{paragraph}</p>)}</section>)}
    <address>{bundle.operatorName}<br /><a tabIndex={0} href={`mailto:${bundle.contactEmail}`}>{bundle.contactEmail}</a></address>
    <nav aria-label="Metin sürümleri"><h2>Sürüm geçmişi</h2><ul>{document.revisions.map(item => <li key={item.version}>
      <a tabIndex={0} href={`/yasal/${document.slug}/${item.version}`} aria-current={item.version === revision.version ? "page" : undefined}>Sürüm {item.version} · {item.publishedOn}</a>
    </li>)}</ul></nav>
  </article>;
}
