"use client";

// The root layout/provider may have failed, so this document cannot depend on
// their context or stylesheets. Never expose the raw server error to the user.
export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="tr">
      <head>
        <meta charSet="utf-8" />
        <title>Kararver yüklenemedi</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          .kv-fatal {
            --background: #faf8f2; --surface: #fff; --text: #292826;
            --accent: #815b21; --border: #e6dfd2;
            margin: 0; min-height: 100vh; background: var(--background);
            color: var(--text); font-family: system-ui, sans-serif; line-height: 1.6;
          }
          .kv-fatal main {
            box-sizing: border-box; width: calc(100% - 48px); max-width: 36rem;
            margin: clamp(24px, 10vh, 96px) auto; padding: 24px;
            background: var(--surface); border: 1px solid var(--border);
            border-radius: 22px; overflow-wrap: anywhere;
          }
          .kv-fatal h1 { line-height: 1.2; }
          .kv-fatal-actions { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }
          .kv-fatal button, .kv-fatal a {
            box-sizing: border-box; display: inline-flex; align-items: center;
            justify-content: center; min-width: 44px; min-height: 44px;
            padding: 12px 16px; font: inherit;
          }
          .kv-fatal button {
            background: #d9ba7f; color: #292826; border: 1px solid #815b21;
            border-radius: 12px; font-weight: 600; cursor: pointer;
          }
          .kv-fatal a { color: var(--accent); text-underline-offset: 4px; }
          .kv-fatal :is(button, a):focus-visible {
            outline: 3px solid var(--accent); outline-offset: 4px;
          }
          @media (prefers-color-scheme: dark) {
            .kv-fatal {
              --background: #181715; --surface: #23211d; --text: #f7f2e8;
              --accent: #e8cd99; --border: #494338;
            }
          }
        `}</style>
      </head>
      <body className="kv-fatal">
        <main>
          <h1 role="alert">Kararver yüklenemedi.</h1>
          <p>Geçici bir sorun oluştu. Sayfayı tekrar yüklemeyi deneyebilirsin.</p>
          <div className="kv-fatal-actions">
            <button onClick={retry}>Tekrar dene</button>
            <a href="/" tabIndex={0}>Ana sayfaya dön</a>
          </div>
        </main>
      </body>
    </html>
  );
}
