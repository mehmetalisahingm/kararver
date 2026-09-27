"use client";
import Link from "next/link";
import { useProduct } from "../../components/product-provider";
export default function Page() {
  const { user } = useProduct();
  return (
    <section className="kv-card screen-stack">
      <h1>{user ? `Merhaba, ${user.name}.` : "Hesabınla katıl."}</h1>
      <p>
        {user
          ? `Demo bakiyen: ${user.balance} puan. E-posta: ${user.email}`
          : "Keşfetmek için giriş yapman gerekmiyor."}
      </p>
      {!user && (
        <Link className="kv-button" href="/giris">
          Giriş yap
        </Link>
      )}
      <Link href="/">Akışa dön</Link>
      <p className="kv-help">
        Bu ekran oturum özetidir. Herkese açık profil ve kaydedilenler kendi
        modülünde geliştirilecek.
      </p>
    </section>
  );
}
