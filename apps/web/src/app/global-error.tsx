"use client";

// The root layout/provider may have failed, so this document cannot depend on
// their context or stylesheets. Never expose the raw server error to the user.
export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="tr">
      <body style={{ margin: 0, background: "#f5f5fa", color: "#17172c", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: "36rem", margin: "10vh auto", padding: "1.5rem", overflowWrap: "anywhere" }}>
          <h1 role="alert">Kararver yüklenemedi.</h1>
          <p>Geçici bir sorun oluştu. Sayfayı tekrar yüklemeyi deneyebilirsin.</p>
          <button onClick={retry} style={{ minHeight: 44, padding: "0.75rem 1rem", font: "inherit", background: "#4324c7", color: "white", border: "2px solid #17172c", borderRadius: 8 }}>
            Tekrar dene
          </button>
          <p><a href="/" style={{ color: "#4324c7" }}>Ana sayfaya dön</a></p>
        </main>
      </body>
    </html>
  );
}
