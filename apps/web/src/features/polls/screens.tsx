"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useProduct } from "../../components/product-provider";
import { ErrorMessage, Loading } from "../../components/fields";
import { UiError } from "../../lib/model";
import type { Poll } from "../../lib/model";
import { SocialPanel } from "../social/social-panel";
import { PollGallery } from "./gallery";

function PollCard({ poll }: { poll: Poll }) {
  return (
    <article className="kv-card poll-card">
      <div className="kv-row kv-between">
        <div className="kv-row">
          <span className="avatar" aria-hidden="true">
            {poll.author[0]}
          </span>
          <span className="author">
            {poll.author}
            <small>{poll.category} · Örnek içerik</small>
          </span>
        </div>
        <span className="kv-badge kv-badge--neutral">
          {poll.kind === "discussion"
            ? "Tartışma"
            : poll.status === "CLOSED"
              ? "Kapandı"
              : poll.status === "LOCKED"
                ? "Kilitli"
                : "Anket"}
        </span>
      </div>
      <h2>
        <Link href={`/karar/${poll.id}`}>{poll.title}</Link>
      </h2>
      <p className="kv-muted">{poll.description}</p>
      {poll.options.some((o) => o.image) && (
        <div className="photo-options">
          {poll.options.map((o) => (
            <div key={o.id}>
              {o.image && <img src={o.image} alt="" width={800} height={530} />}
              <span>{o.label}</span>
            </div>
          ))}
        </div>
      )}
      <div className="kv-row kv-between">
        <span className="kv-help">
          {poll.commentCount ?? poll.comments.length} örnek yorum / öneri
        </span>
        <Link
          className="kv-button kv-button--secondary"
          href={`/karar/${poll.id}`}
        >
          {poll.kind === "discussion" ? "Tartışmayı oku" : "Anketi incele"}
        </Link>
      </div>
    </article>
  );
}
export function Feed({ title = "Senin için" }: { title?: string }) {
  const { client, user } = useProduct();
  const [polls, setPolls] = useState<Poll[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let active = true;
    setPolls(null);
    setError("");
    client
      .list()
      .then((p) => {
        if (active) setPolls(p);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [client, user?.id, attempt]);
  const filtered = polls?.filter((p) =>
    `${p.title} ${p.category}`
      .toLocaleLowerCase("tr")
      .includes(query.toLocaleLowerCase("tr")),
  );
  return (
    <div className="screen-stack">
      <div>
        <span className="eyebrow">HER FİKİR YENİ BİR BAKIŞ AÇISI</span>
        <h1>{title}</h1>
        <p className="kv-muted">Merak et, keşfet, birlikte karar ver.</p>
      </div>
      <label className="kv-field">
        Örnek akışta ara
        <input
          className="kv-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Bir konu veya kategori…"
        />
      </label>
      {error ? (
        <div className="kv-card kv-state">
          <ErrorMessage message={error} />
          <button className="kv-button" onClick={() => retry((n) => n + 1)}>
            Tekrar dene
          </button>
        </div>
      ) : !polls ? (
        <Loading label="Akış yükleniyor…" />
      ) : filtered?.length ? (
        filtered.map((p) => <PollCard poll={p} key={p.id} />)
      ) : (
        <div className="kv-card kv-state">
          <h2>Henüz bir eşleşme yok.</h2>
          <p className="kv-muted">Başka bir kelimeyle tekrar deneyebilirsin.</p>
          <button
            className="kv-button kv-button--secondary"
            onClick={() => setQuery("")}
          >
            Aramayı temizle
          </button>
        </div>
      )}
    </div>
  );
}
export function PollDetail({ id }: { id: string }) {
  const { client, user, selections, select, requireUser, notify, syncUser } =
    useProduct();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    setPoll(null);
    setLoadError("");
    client
      .get(id)
      .then((p) => {
        if (active) setPoll(p);
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
      notify("Oyun kaydedildi. Yayın puanın değişmedi.");
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
  return (
    <div className="screen-stack">
      <Link href="/" className="back-link">
        ← Akışa dön
      </Link>
      <article className="kv-card poll-card">
        <div className="kv-row kv-between">
          <span className="kv-badge">{poll.category}</span>
          <span className="kv-help">{poll.author} · Örnek içerik</span>
        </div>
        <h1>{poll.title}</h1>
        <p className="kv-muted">{poll.description}</p>
        {poll.kind === "poll" && (
          <>
            <fieldset
              id="vote-options"
              tabIndex={-1}
              disabled={busy || closed || Boolean(poll.ownVote)}
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
                        checked={(poll.ownVote || selections[id]) === option.id}
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
            {!closed && !poll.ownVote && (
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
                <p className="kv-help">Toplam {poll.results.total} örnek oy</p>
              </section>
            ) : (
              <p className="private-results">
                Sonuçlar oy verdikten sonra görünür.
              </p>
            )}
          </>
        )}
      </article>
      <PollGallery key={poll.id} poll={poll} />
      <SocialPanel key={`${poll.id}:${user?.id || "guest"}`} poll={poll} />
    </div>
  );
}
