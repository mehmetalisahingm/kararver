"use client";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useProduct } from "../../components/product-provider";
import { ErrorMessage, Loading } from "../../components/fields";
import type { Poll, PublicProfile } from "../../lib/model";

export default function Page() {
  const { user, client, notify, syncUser } = useProduct();
  const [displayName, setDisplayName] = useState(user?.name ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [saved, setSaved] = useState<Poll[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [attempt, retry] = useState(0);

  useEffect(() => {
    setDisplayName(user?.name ?? "");
    setBio(user?.bio ?? "");
    if (!user || !user.username || !client.getProfile || !client.getBookmarks) return;
    let active = true;
    setLoading(true);
    setLoadError("");
    setError("");
    Promise.all([client.getProfile(user.username), client.getBookmarks()])
      .then(([nextProfile, bookmarks]) => {
        if (!active) return;
        setProfile(nextProfile);
        setSaved(bookmarks.data);
        setCursor(bookmarks.page.nextCursor);
      })
      .catch((e) => active && setLoadError((e as Error).message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [client, user?.id, user?.username, user?.name, user?.bio, attempt]);

  if (!user) {
    return (
      <section className="kv-card screen-stack">
        <h1>Hesabınla katıl.</h1>
        <p>Keşfetmek için giriş yapman gerekmiyor; profilini ve kaydettiklerini görmek için giriş yap.</p>
        <Link className="kv-button" href="/giris?returnTo=%2Fhesap">Giriş yap</Link>
        <Link href="/">Akışa dön</Link>
      </section>
    );
  }

  const username = user.username;

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!client.updateProfile || busy) return;
    setBusy(true);
    setError("");
    try {
      await client.updateProfile({ displayName: displayName.trim(), bio: bio.trim() || null });
      syncUser();
      notify("Profilin güncellendi.");
      if (username && client.getProfile) setProfile(await client.getProfile(username));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeBookmark(poll: Poll) {
    if (busy || !client.setBookmark) return;
    setBusy(true); setError("");
    try {
      await client.setBookmark(poll.id, false);
      setSaved((items) => items.filter((item) => item.id !== poll.id));
      notify("Kayıt kaldırıldı.");
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function loadMore() {
    if (busy || !cursor || !client.getBookmarks) return;
    setBusy(true);
    setError("");
    try {
      const page = await client.getBookmarks(cursor);
      setSaved((items) => [...items, ...page.data]);
      setCursor(page.page.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const realProfile = Boolean(client.updateProfile && client.getBookmarks);
  return (
    <div className="screen-stack">
      <section className="kv-card screen-stack">
        <div className="kv-row kv-between">
          <div>
            <span className="eyebrow">HESABIM</span>
            <h1>{user.name}</h1>
            <p className="kv-muted">{user.email}</p>
          </div>
          {username && <Link className="kv-button kv-button--secondary" href={`/profil/${username}`}>Public profili gör</Link>}
        </div>

        {profile && (
          <div className="kv-row" aria-label="Profil istatistikleri">
            <span className="kv-badge">{profile.stats.pollCount} gönderi</span>
            <span className="kv-badge">{profile.stats.votesReceived} alınan oy</span>
            <span className="kv-badge">{profile.stats.commentCount} yorum</span>
          </div>
        )}

        {realProfile ? (
          <form className="screen-stack" onSubmit={saveProfile}>
            <label>
              Görünen ad
              <input value={displayName} maxLength={60} required onChange={(e) => setDisplayName(e.target.value)} />
            </label>
            <label>
              Biyografi
              <textarea value={bio ?? ""} maxLength={300} rows={4} onChange={(e) => setBio(e.target.value)} />
            </label>
            <ErrorMessage message={error} />
            <button className="kv-button" disabled={busy || !displayName.trim()} aria-busy={busy}>
              {busy ? "Kaydediliyor…" : "Profili kaydet"}
            </button>
          </form>
        ) : (
          <p className="kv-help">Demo modunda profil değişiklikleri kalıcı değildir. Gerçek API modunda profil düzenleme ve private kaydetme aktiftir.</p>
        )}

        <div className="kv-row">
          <Link className="kv-button kv-button--secondary" href="/ilgi-alanlari">İlgi alanlarını düzenle</Link>
          <Link href="/">Akışa dön</Link>
        </div>
      </section>

      {realProfile && (
        <section className="kv-card screen-stack" aria-labelledby="saved-title">
          <div className="kv-row kv-between">
            <div>
              <span className="eyebrow">SADECE SEN GÖRÜRSÜN</span>
              <h2 id="saved-title">Kaydedilenler</h2>
            </div>
            <span className="kv-help">Private liste</span>
          </div>
          {loading ? <Loading label="Kaydedilenler yükleniyor…" /> : loadError ? (
            <div><ErrorMessage message={loadError} /><button className="kv-button" onClick={() => retry(n => n + 1)}>Kaydedilenleri tekrar yükle</button></div>
          ) : saved.length === 0 ? (
            <p className="kv-muted">Henüz bir gönderi kaydetmedin.</p>
          ) : saved.map((poll) => (
            <article className="kv-card" key={poll.id}>
              <div className="kv-row kv-between">
                <div>
                  <span className="kv-badge">{poll.category}</span>
                  <h3><Link href={poll.canonicalPath ?? `/karar/${poll.id}`}>{poll.title}</Link></h3>
                  <p className="kv-muted">{poll.author}</p>
                </div>
                <button className="kv-button kv-button--ghost" disabled={busy} onClick={() => void removeBookmark(poll)}>Kaydı kaldır</button>
              </div>
            </article>
          ))}
          {cursor && <button className="kv-button kv-button--secondary" disabled={busy} onClick={() => void loadMore()}>Daha fazla göster</button>}
        </section>
      )}
    </div>
  );
}
