import Link from "next/link";
export default function Page() {
  return (
    <section className="kv-card kv-state">
      <h1>Bildirimler</h1>
      <p>Bildirim merkezi kendi modülü hazır olduğunda buraya bağlanacak.</p>
      <Link className="kv-button kv-button--secondary" href="/">
        Akışa dön
      </Link>
    </section>
  );
}
