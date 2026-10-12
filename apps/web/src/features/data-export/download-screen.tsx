"use client";
// KVKK veri paketi indirme sayfası (#181): e-postadaki bağlantıyla açılır (/veri-indir#token=…). İndirme açık bir tıklamayla
// başlar (sayfa açılışı indirme hakkını harcamaz). Paket sunucuda çözülüp JSON olarak gelir ve tarayıcıda dosyaya yazılır;
// hiçbir yerde saklanmaz veya loglanmaz.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useProduct } from "../../components/product-provider";
import { ApiClient } from "../../lib/api-client";
import { downloadErrorMessage, forgetToken, packageFileName, resolveToken } from "./download-model";

type Phase = "idle" | "busy" | "done" | "failed";

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function DataExportDownloadScreen() {
  const { client, demo, user } = useProduct();
  const [token, setToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState({ message: "", retryable: false });

  useEffect(() => {
    const resolved = resolveToken(window.location.hash, sessionStore());
    // Strict Mode may repeat setup after the fragment was removed; keep the in-memory link if storage is blocked.
    setToken(current => resolved ?? current);
    // Token adres çubuğunda ve geçmişte kalmasın.
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname);
    setChecked(true);
  }, []);

  async function download() {
    if (!token || !(client instanceof ApiClient) || phase === "busy") return;
    setPhase("busy");
    try {
      const pkg = await client.downloadDataExport(token);
      const url = URL.createObjectURL(new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = packageFileName(new Date());
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setPhase("done");
    } catch (cause) {
      const described = downloadErrorMessage(cause);
      setFailure(described);
      // Geçersiz bağlantıyı saklamaya gerek yok; yeniden denenebilir hatada token kalır.
      if (!described.retryable) forgetToken(sessionStore());
      setPhase("failed");
    }
  }

  const heading = <h1>Verilerini indir</h1>;
  if (demo) {
    return <section className="auth-card kv-card screen-stack">{heading}<p className="kv-muted">Bu özellik demo modunda yoktur.</p></section>;
  }
  if (!checked) return <section className="auth-card kv-card screen-stack" aria-busy="true">{heading}<p className="kv-muted" role="status">Yükleniyor…</p></section>;
  if (!token) {
    return (
      <section className="auth-card kv-card screen-stack">
        {heading}
        <p>Bu sayfa e-postana gönderilen bağlantıyla açılır. Bağlantı bulunamadı veya bu sekmede artık geçerli değil.</p>
        <p className="kv-muted">Yeni bir bağlantı için destek ile iletişime geç.</p>
      </section>
    );
  }
  if (!user) {
    return (
      <section className="auth-card kv-card screen-stack">
        {heading}
        <p>Verilerini indirmek için önce bu bağlantının gönderildiği hesapla giriş yapmalısın.</p>
        <Link className="kv-button" href="/giris?returnTo=%2Fveri-indir">Giriş yap</Link>
      </section>
    );
  }
  return (
    <section className="auth-card kv-card screen-stack">
      {heading}
      <p>
        KararVer hesabına ait kişisel veri paketin hazır. Paket bir JSON dosyası olarak bu cihaza iner; profilini, içeriklerini,
        oylarını, bildirimlerini ve oturum bilgilerini içerir. Dosya şifresizdir: güvenli bir yerde sakla ve başkasıyla paylaşma.
      </p>
      <p className="kv-muted">Bağlantının indirme hakkı sınırlıdır (en çok 3) ve 24 saat sonra geçersiz olur.</p>
      {phase === "done" ? <p role="status">İndirme başladı. Dosyayı kaydettikten sonra bu sayfayı kapatabilirsin.</p> : null}
      {phase === "failed" ? <p role="alert">{failure.message}</p> : null}
      {phase !== "done" && (phase !== "failed" || failure.retryable) ? (
        <button type="button" className="kv-button" disabled={phase === "busy"} onClick={() => void download()}>
          {phase === "busy" ? "Hazırlanıyor…" : phase === "failed" ? "Tekrar dene" : "Verilerimi indir"}
        </button>
      ) : null}
    </section>
  );
}
