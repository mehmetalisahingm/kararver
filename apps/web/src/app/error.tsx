"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="kv-card kv-state">
      <h1>Sayfa yüklenemedi.</h1>
      <p>Tekrar deneyebilirsin.</p>
      <button className="kv-button" onClick={reset}>
        Tekrar dene
      </button>
    </section>
  );
}
