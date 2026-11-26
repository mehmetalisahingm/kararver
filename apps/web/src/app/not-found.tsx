import Link from "next/link";
export default function NotFound() {
  return (
    <section className="kv-card kv-state kv-not-found">
      <h1>Bu sayfayı bulamadık.</h1>
      <p>Bağlantı değişmiş olabilir.</p>
      <Link href="/" className="kv-button">
        Akışa dön
      </Link>
    </section>
  );
}
