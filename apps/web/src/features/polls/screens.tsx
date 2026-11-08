"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useProduct } from "../../components/product-provider";
import { ErrorMessage, Loading } from "../../components/fields";
import { UiError } from "../../lib/model";
import type { Poll } from "../../lib/model";
import { ReportButton } from "../community/report-dialog";
import { SocialPanel } from "../social/social-panel";
import { DecisionPanel } from "./decision-panel";
import { PollGallery } from "./gallery";
import { IllustratedScene, visualTopic } from "../../components/visual-story";

const planets = ["choice-planet.webp", "choice-desert.webp", "choice-ice.webp", "choice-gas.webp", "choice-volcanic.webp", "choice-ocean.webp"];
const planetStyle = (index: number): CSSProperties => ({
  "--planet-image": `url('/art/space/${planets[index % planets.length]}')`,
  "--planet-hue": "0deg",
} as CSSProperties);

export function PollDetail({ id }: { id: string }) {
  const { client, user, selections, select, requireUser, notify, syncUser } =
    useProduct();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [sound, setSound] = useState(false);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    if (!launched) return;
    const timer = setTimeout(() => setLaunched(false), 700);
    return () => clearTimeout(timer);
  }, [launched]);
  useEffect(() => {
    let active = true;
    setPoll(null);
    setSaved(false);
    setLoadError("");
    client
      .get(id)
      .then(async (p) => {
        if (!active) return;
        setPoll(p);
        if (!user || !client.getBookmarks) return;
        // Contract'ta tek bookmark status endpoint'i yok; private listeyi cursor ile tarayarak
        // ilk render'da doğru Kaydet/Kaldır durumunu buluruz. PUT yine doğal idempotent'tir.
        let cursor: string | undefined;
        do {
          const page = await client.getBookmarks(cursor);
          if (!active) return;
          if (page.data.some((item) => item.id === p.id)) {
            setSaved(true);
            return;
          }
          cursor = page.page.nextCursor ?? undefined;
        } while (cursor);
      })
      .catch((e) => {
        if (active) setLoadError(e.message);
      });
    return () => {
      active = false;
    };
  }, [client, id, user?.id, attempt]);
  async function vote() {
    if (!selections[id]) {
      setError("Bir seçenek seçmelisin.");
      document.getElementById("vote-options")?.focus();
      return;
    }
    if (!requireUser(`/karar/${id}`) || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await client.vote(id, selections[id]);
      setPoll(next);
      setLaunched(true);
      notify("Oyun kaydedildi.");
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof UiError && e.code === "UNAUTHENTICATED") {
        syncUser();
        requireUser(`/karar/${id}`);
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function playChoiceSound() {
    if (!sound) return;
    try {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(440, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(590, context.currentTime + .12);
      gain.gain.setValueAtTime(.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.025, context.currentTime + .025);
      gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .2);
      oscillator.connect(gain).connect(context.destination);
      oscillator.onended = () => { void context.close(); };
      oscillator.start(); oscillator.stop(context.currentTime + .21);
    } catch { /* Audio is optional and must never block a choice. */ }
  }
  async function toggleBookmark() {
    if (!poll || !requireUser(`/karar/${id}`) || !client.setBookmark || bookmarkBusy) return;
    setBookmarkBusy(true);
    setError("");
    try {
      const next = await client.setBookmark(poll.id, !saved);
      setSaved(next);
      notify(next ? "Gönderi kaydedildi." : "Kayıt kaldırıldı.");
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof UiError && e.code === "UNAUTHENTICATED") {
        syncUser();
        requireUser(`/karar/${id}`);
      }
    } finally {
      setBookmarkBusy(false);
    }
  }
  if (loadError)
    return (
      <div className="kv-card kv-state">
        <h1>İçerik açılamadı.</h1>
        <ErrorMessage message={loadError} />
        <button className="kv-button" onClick={() => retry((n) => n + 1)}>
          Tekrar dene
        </button>
        <Link href="/">Akışa dön</Link>
      </div>
    );
  if (!poll) return <Loading label="İçerik yükleniyor…" />;
  const closed =
    poll.status !== "ACTIVE" || Date.parse(poll.closesAt) <= Date.now();
  const blocked = poll.canVote === false || (poll.canVote === undefined && Boolean(poll.ownVote));
  const blockMessages: Record<string, string> = { OWN_POLL: "Kendi anketinde oy kullanamazsın.", EMAIL_NOT_VERIFIED: "Oy vermek için e-postanı doğrulamalısın.", ACCOUNT_RESTRICTED: "Hesabın bu işlem için kısıtlanmış.", VOTE_INVALIDATED: "Bu anketteki oyun geçersiz kılınmış.", VOTE_CHANGE_DISABLED: "Bu ankette oy değiştirme kapalı." };
  return (
    <div className="screen-stack">
      <Link href="/" className="back-link">
        ← Akışa dön
      </Link>
      <article className="kv-card poll-card orbital-poll">
        <div className="kv-row kv-between">
          <span className="kv-badge">{poll.category}</span>
          <div className="kv-row">
            <span className="kv-help">{poll.author}</span>
            <ReportButton target={{ type: "POLL", id: poll.id }} label="Bu içeriği raporla" />
            {client.setBookmark && (
              <button
                className="kv-button kv-button--ghost"
                disabled={bookmarkBusy}
                aria-pressed={saved}
                onClick={() => void toggleBookmark()}
              >
                {bookmarkBusy ? "Kaydediliyor…" : saved ? "Kaydı kaldır" : "Kaydet"}
              </button>
            )}
          </div>
        </div>
        {!poll.gallery?.some((item) => item.status === "ready") && !poll.options.some((option) => option.image) && (
          <div className="kv-poll-visual" data-illustration="true">
            <IllustratedScene topic={visualTopic(poll.category || poll.title)} />
          </div>
        )}
        <h1>{poll.title}</h1>
        <p className="kv-muted">{poll.description}</p>
        {poll.kind === "poll" && (
          <>
            <div className="choice-sound"><button type="button" aria-pressed={sound} onClick={() => setSound(value => !value)}>{sound ? "♪ Ses açık" : "♪ Ses kapalı"}</button><span>Seçim sesi · isteğe bağlı</span></div>
            <fieldset
              id="vote-options"
              tabIndex={-1}
              disabled={busy || closed || blocked}
            >
              <legend>
                {closed
                  ? poll.status === "LOCKED"
                    ? "Bu anket kilitli."
                    : "Bu anket kapandı."
                  : poll.ownVote
                    ? "Oyun kaydedildi."
                    : "Sen hangisini seçerdin?"}
              </legend>
              <div className="vote-options orbital-options" data-launching={busy || launched}>
                {poll.options.map((option, index) => (
                  <label className="vote-option orbital-option" key={option.id} style={planetStyle(index)}>
                    <div className="orbital-option__scene" data-photo={Boolean(option.image)} aria-hidden="true">
                      {option.image && <img className="orbital-option__photo" src={option.image} alt="" width={800} height={530} />}
                      <div className="orbital-option__number">0{index + 1} / SEÇENEK</div>
                      <div className="orbital-option__ring" />
                      <div className="orbital-option__planet" />
                      <div className="orbital-option__star" />
                    </div>
                    <span>
                      <input
                        name="vote"
                        type="radio"
                        aria-label={option.label}
                        value={option.id}
                        checked={(selections[id] || poll.ownVote) === option.id}
                        onChange={() => {
                          select(id, option.id);
                          setError("");
                          playChoiceSound();
                        }}
                      />
                      {option.label}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <ErrorMessage message={error} />
            {poll.voteBlockedReason && blockMessages[poll.voteBlockedReason] && <p role="status">{blockMessages[poll.voteBlockedReason]}{poll.voteBlockedReason === "EMAIL_NOT_VERIFIED" && <Link href="/dogrula"> E-postayı doğrula</Link>}</p>}
            {!closed && !blocked && (
              <button
                className="kv-button"
                disabled={busy}
                aria-busy={busy}
                onClick={vote}
              >
                {busy ? "Oy kaydediliyor…" : "Oyumu onayla"}
              </button>
            )}
            {poll.results.visible ? (
              <section className="screen-stack orbital-results" aria-labelledby="results-title">
                <div className="orbital-results__heading"><div><p className="orbital-results__eyebrow">BİRLİKTE ŞEKİLLENEN BİR EVREN</p><h2 id="results-title">Sonuçlar</h2></div><p>Her oy, bu hikâyede bir iz bırakır.</p></div>
                {poll.results.options.map((result) => (
                  <div className="result orbital-result" key={result.id} style={{ ...planetStyle(Math.max(0, poll.options.findIndex(option => option.id === result.id))), "--planet-scale": String(0.45 + Math.max(0, Math.min(100, result.percent)) / 100 * 0.55) } as CSSProperties}>
                    <div className="orbital-result__world" aria-hidden="true"><div className="orbital-result__planet" /></div>
                    <div className="orbital-result__detail">
                    <div className="kv-row kv-between">
                      <span>
                        {poll.options.find((o) => o.id === result.id)?.label}
                      </span>
                      <strong>
                        %{result.percent} · {result.votes} oy
                      </strong>
                    </div>
                    <progress
                      value={result.percent}
                      max="100"
                      aria-label={`${poll.options.find((o) => o.id === result.id)?.label} yüzde ${result.percent}`}
                    />
                    </div>
                  </div>
                ))}
                <p className="kv-help">Toplam {poll.results.total} oy</p>
              </section>
            ) : (
              <p className="private-results">
                Sonuçlar oy verdikten sonra görünür.
              </p>
            )}
            <section className="comparison-desk" aria-labelledby="comparison-title">
              <div><span className="comparison-desk__eyebrow">KARŞILAŞTIRMA MASASI</span><h2 id="comparison-title">Seçeneklere yakından bak.</h2><p>Kararını verirken seçenekleri yan yana gör.</p></div>
              <div className="comparison-desk__scroll" role="region" aria-label="Seçenek karşılaştırma tablosu" tabIndex={0}><table><caption className="sr-only">Seçeneklerin karşılaştırması</caption><thead><tr><th scope="col">Seçenek</th>{poll.options.map(option => <th scope="col" key={option.id}>{option.label}</th>)}</tr></thead><tbody><tr><th scope="row">Oy oranı</th>{poll.options.map(option => <td key={option.id}>{poll.results.visible ? `%${poll.results.options.find(result => result.id === option.id)?.percent ?? 0}` : "Gizli"}</td>)}</tr><tr><th scope="row">Oy sayısı</th>{poll.options.map(option => <td key={option.id}>{poll.results.visible ? poll.results.options.find(result => result.id === option.id)?.votes ?? 0 : "Gizli"}</td>)}</tr></tbody></table></div>
              {!poll.results.visible && <p className="comparison-desk__note">Bu anketin sonuçları henüz sana açık değil.</p>}
              <a className="comparison-desk__link" href="#comments-title">Yorumları ve alternatif önerileri incele →</a>
            </section>
          </>
        )}
      </article>
      <DecisionPanel key={`decision:${poll.id}:${user?.id || "guest"}`} poll={poll} />
      <PollGallery key={poll.id} poll={poll} />
      <SocialPanel key={`${poll.id}:${user?.id || "guest"}`} poll={poll} />
    </div>
  );
}
