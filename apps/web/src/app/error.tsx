"use client";
export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <section className="kv-card kv-state">
      <h1 role="alert">Sayfa yüklenemedi.</h1>
      <p>Tekrar deneyebilirsin.</p>
      <button className="kv-button" onClick={retry}>
        Tekrar dene
      </button>
    </section>
  );
}
