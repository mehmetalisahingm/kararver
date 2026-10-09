"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useProduct } from "../../components/product-provider";
import { ErrorMessage, Loading } from "../../components/fields";
import { UiError } from "../../lib/model";
import type { Poll } from "../../lib/model";
import { ReportButton } from "../community/report-dialog";
import { SocialPanel } from "../social/social-panel";
import { DecisionPanel } from "./decision-panel";
import { PollGallery } from "./gallery";

export function PollDetail({ id }: { id: string }) {
  const { client, user, selections, select, requireUser, notify, syncUser } =
    useProduct();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const lock = useRef(false);
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
      <article className="kv-card poll-card">
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
        <h1>{poll.title}</h1>
        <p className="kv-muted">{poll.description}</p>
        {poll.kind === "poll" && (
          <>
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
              <div className="vote-options">
                {poll.options.map((option) => (
                  <label className="vote-option" key={option.id}>
                    {option.image && (
                      <img src={option.image} alt="" width={800} height={530} />
                    )}
                    <span>
                      <input
                        name="vote"
                        type="radio"
                        value={option.id}
                        checked={(selections[id] || poll.ownVote) === option.id}
                        onChange={() => {
                          select(id, option.id);
                          setError("");
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
              <section className="screen-stack" aria-labelledby="results-title">
                <h2 id="results-title">Sonuçlar</h2>
                {poll.results.options.map((result) => (
                  <div className="result" key={result.id}>
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
                ))}
                <p className="kv-help">Toplam {poll.results.total} oy</p>
              </section>
            ) : (
              <p className="private-results">
                Sonuçlar oy verdikten sonra görünür.
              </p>
            )}
          </>
        )}
      </article>
      <DecisionPanel key={`decision:${poll.id}:${user?.id || "guest"}`} poll={poll} />
      <PollGallery key={poll.id} poll={poll} />
      <SocialPanel key={`${poll.id}:${user?.id || "guest"}`} poll={poll} />
    </div>
  );
}
