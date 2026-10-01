"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useProduct } from "../../../components/product-provider";
import { ErrorMessage, Loading } from "../../../components/fields";
import type { Poll, ProfileComment, PublicProfile } from "../../../lib/model";

export default function Page() {
  const params = useParams<{ username: string }>();
  const username = params.username;
  const { client, user } = useProduct();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [comments, setComments] = useState<ProfileComment[]>([]);
  const [pollCursor, setPollCursor] = useState<string | null>(null);
  const [commentCursor, setCommentCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!client.getProfile || !client.getProfilePolls || !client.getProfileComments) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([
      client.getProfile(username),
      client.getProfilePolls(username),
      client.getProfileComments(username),
    ])
      .then(([nextProfile, pollPage, commentPage]) => {
        if (!active) return;
        setProfile(nextProfile);
        setPolls(pollPage.data);
        setPollCursor(pollPage.page.nextCursor);
        setComments(commentPage.data);
        setCommentCursor(commentPage.page.nextCursor);
      })
      .catch((e) => active && setError((e as Error).message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [client, username, user?.id]);

  async function morePolls() {
    if (!pollCursor || !client.getProfilePolls) return;
    const page = await client.getProfilePolls(username, pollCursor);
    setPolls((old) => [...old, ...page.data]);
    setPollCursor(page.page.nextCursor);
  }

  async function moreComments() {
    if (!commentCursor || !client.getProfileComments) return;
    const page = await client.getProfileComments(username, commentCursor);
    setComments((old) => [...old, ...page.data]);
    setCommentCursor(page.page.nextCursor);
  }

  if (loading) return <Loading label="Profil yükleniyor…" />;
  if (error) return <section className="kv-card kv-state"><h1>Profil açılamadı.</h1><ErrorMessage message={error} /><Link href="/">Akışa dön</Link></section>;
  if (!profile) return <section className="kv-card kv-state"><h1>Profil demo modunda kullanılamıyor.</h1><p>Gerçek API modunda public profil, gönderiler ve yorumlar burada gösterilir.</p><Link href="/">Akışa dön</Link></section>;

  return (
    <div className="screen-stack">
      <Link href="/" className="back-link">← Akışa dön</Link>
      <section className="kv-card screen-stack">
        <div className="kv-row kv-between">
          <div>
            <span className="eyebrow">PUBLIC PROFİL</span>
            <h1>{profile.displayName}</h1>
            <p className="kv-muted">@{profile.username}</p>
          </div>
          {profile.avatarUrl && <img src={profile.avatarUrl} alt="" width={72} height={72} />}
        </div>
        {profile.bio && <p>{profile.bio}</p>}
        <div className="kv-row" aria-label="Profil istatistikleri">
          <span className="kv-badge">{profile.stats.pollCount} gönderi</span>
          <span className="kv-badge">{profile.stats.votesReceived} alınan oy</span>
          <span className="kv-badge">{profile.stats.commentCount} yorum</span>
        </div>
        <p className="kv-help">Katılım: {new Date(profile.joinedAt).toLocaleDateString("tr-TR")}</p>
      </section>

      <section className="kv-card screen-stack" aria-labelledby="profile-polls">
        <h2 id="profile-polls">Gönderiler</h2>
        {polls.length === 0 ? <p className="kv-muted">Henüz görünür gönderi yok.</p> : polls.map((poll) => (
          <article key={poll.id} className="kv-card">
            <span className="kv-badge">{poll.category}</span>
            <h3><Link href={poll.canonicalPath ?? `/karar/${poll.id}`}>{poll.title}</Link></h3>
            <p className="kv-muted">{poll.description}</p>
          </article>
        ))}
        {pollCursor && <button className="kv-button kv-button--secondary" onClick={() => void morePolls()}>Daha fazla gönderi</button>}
      </section>

      <section className="kv-card screen-stack" aria-labelledby="profile-comments">
        <h2 id="profile-comments">Yorumlar</h2>
        {comments.length === 0 ? <p className="kv-muted">Henüz görünür yorum yok.</p> : comments.map((comment) => (
          <article key={comment.id} className="kv-card">
            <p>{comment.body}</p>
            <div className="kv-row kv-between">
              <span className="kv-help">{new Date(comment.createdAt).toLocaleDateString("tr-TR")}</span>
              <Link href={`/karar/${comment.pollId}`}>İçeriğe git</Link>
            </div>
          </article>
        ))}
        {commentCursor && <button className="kv-button kv-button--secondary" onClick={() => void moreComments()}>Daha fazla yorum</button>}
      </section>
    </div>
  );
}
