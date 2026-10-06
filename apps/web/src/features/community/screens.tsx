"use client";

// Topluluk ekranları (KV-31): liste ve topluluk sayfası (katıl/ayrıl, üye listesi, topluluk akışı). Üye listesi
// görünürlüğü sunucuda uygulanır; yetkisiz izleyici 404 alır ve bölüm açıklayıcı bir durumla gösterilir.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ErrorMessage, Loading } from "../../components/fields";
import { useProduct } from "../../components/product-provider";
import { PollCard } from "../polls/poll-card";
import { UiError } from "../../lib/model.ts";
import type { Poll } from "../../lib/model.ts";
import type { CommunityPage, CommunitySummary, Member, Paged } from "./community-client.ts";

const roleLabels = { MEMBER: "Üye", MODERATOR: "Moderatör" } as const;
const visibilityNotes = {
  PUBLIC: "Üye listesi herkese açık.",
  MEMBERS: "Üye listesini yalnız üyeler görür.",
  MODERATORS: "Üye listesini yalnız moderatörler görür.",
} as const;

function messageOf(error: unknown) {
  return error instanceof UiError ? error.message : "Beklenmeyen bir hata oluştu. Tekrar deneyebilirsin.";
}

/** Sayfalı liste yükleme: ilk sayfa + "daha fazla"; kaynak değişince baştan, eski cevap yeni listeye karışmaz. */
function usePaged<T>(load: ((cursor: string | undefined, signal: AbortSignal) => Promise<Paged<T>>) | null) {
  const [items, setItems] = useState<T[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(load));
  const [more, setMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [attempt, retry] = useState(0);
  const signal = useRef<AbortController | null>(null);

  useEffect(() => {
    signal.current?.abort();
    if (!load) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    signal.current = controller;
    setLoading(true);
    setError(null);
    load(undefined, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setItems(page.items);
        setNext(page.next);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setItems([]);
        setNext(null);
        setError(cause);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load, attempt]);

  const loadMore = useCallback(() => {
    if (!load || !next || more) return;
    const controller = signal.current ?? new AbortController();
    setMore(true);
    load(next, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setItems((previous) => [...previous, ...page.items]);
        setNext(page.next);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause);
      })
      .finally(() => setMore(false));
  }, [load, next, more]);

  return { items, loading, more, error, hasMore: next !== null, retry: () => retry((n) => n + 1), loadMore };
}

function CommunityCardView({ community }: { community: CommunitySummary }) {
  return (
    <article className="kv-card kv-stack">
      <div className="kv-row kv-between">
        <h2>
          <Link href={`/topluluk/${community.slug}`}>{community.name}</Link>
        </h2>
        <span className="kv-badge kv-badge--neutral">{community.memberCount} üye</span>
      </div>
      {community.description ? <p className="kv-muted">{community.description}</p> : null}
    </article>
  );
}

export function CommunitiesScreen() {
  const { client } = useProduct();
  const api = client.community;
  const load = useCallback((cursor: string | undefined, signal: AbortSignal) => api!.list(cursor, signal), [api]);
  const list = usePaged(api ? load : null);

  if (!api) {
    return (
      <section className="kv-card kv-state">
        <span className="eyebrow">TOPLULUKLAR</span>
        <h1>Topluluklar</h1>
        <p className="kv-muted">Topluluklar demo veri kipinde gösterilmez; gerçek API ile açılır.</p>
      </section>
    );
  }
  return (
    <section className="screen-stack">
      <div>
        <span className="eyebrow">TOPLULUKLAR</span>
        <h1>Topluluklar</h1>
        <p className="kv-muted">Ortak ilgi alanları etrafında toplanan topluluklara katıl; sorularını onlara sor.</p>
      </div>
      {list.loading ? <Loading label="Topluluklar yükleniyor…" /> : null}
      {list.error ? (
        <div className="kv-card kv-state">
          <ErrorMessage message={messageOf(list.error)} />
          <button className="kv-button kv-button--secondary" onClick={list.retry}>Tekrar dene</button>
        </div>
      ) : null}
      {!list.loading && !list.error && list.items.length === 0 ? (
        <div className="kv-card kv-state"><p className="kv-muted">Henüz açık topluluk yok.</p></div>
      ) : null}
      {list.items.map((community) => <CommunityCardView key={community.id} community={community} />)}
      {list.hasMore ? (
        <button className="kv-button kv-button--secondary" onClick={list.loadMore} disabled={list.more}>
          {list.more ? "Yükleniyor…" : "Daha fazla göster"}
        </button>
      ) : null}
    </section>
  );
}

function Members({ community }: { community: CommunityPage }) {
  const { client } = useProduct();
  const api = client.community!;
  const [hidden, setHidden] = useState(false);
  const load = useCallback(
    async (cursor: string | undefined, signal: AbortSignal) => {
      try {
        return await api.members(community.id, cursor, signal);
      } catch (cause) {
        // Yetkisiz izleyici 404 alır (listenin varlığı sızmaz): hata değil, kapalı liste durumu.
        if (cause instanceof UiError && (cause.code === "NOT_FOUND" || cause.code === "ENDPOINT_UNAVAILABLE")) {
          setHidden(true);
          return { items: [] as Member[], next: null };
        }
        throw cause;
      }
    },
    [api, community.id, community.viewer?.role],
  );
  const members = usePaged(load);

  return (
    <section className="kv-card kv-stack" aria-labelledby="community-members">
      <h2 id="community-members">Üyeler</h2>
      <p className="kv-help">{visibilityNotes[community.membersVisibility]}</p>
      {members.loading ? <p role="status" aria-busy="true">Üyeler yükleniyor…</p> : null}
      {members.error ? (
        <>
          <ErrorMessage message={messageOf(members.error)} />
          <button className="kv-button kv-button--secondary" onClick={members.retry}>Tekrar dene</button>
        </>
      ) : null}
      {hidden ? <p className="kv-muted">Bu topluluğun üye listesini göremiyorsun.</p> : null}
      {!members.loading && !members.error && !hidden && members.items.length === 0 ? <p className="kv-muted">Henüz üye yok.</p> : null}
      {members.items.length > 0 ? (
        <ul className="kv-stack" aria-label="Üye listesi">
          {members.items.map((member) => (
            <li key={member.user.id} className="kv-row kv-between">
              <span>
                <strong>{member.user.displayName}</strong> <small className="kv-muted">@{member.user.username}</small>
              </span>
              <span className="kv-badge kv-badge--neutral">{roleLabels[member.role]}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {members.hasMore ? (
        <button className="kv-button kv-button--secondary" onClick={members.loadMore} disabled={members.more}>
          {members.more ? "Yükleniyor…" : "Daha fazla göster"}
        </button>
      ) : null}
    </section>
  );
}

export function CommunityScreen({ slug }: { slug: string }) {
  const { client, requireUser, notify, user } = useProduct();
  const api = client.community;
  const [community, setCommunity] = useState<CommunityPage | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, retry] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    setState("loading");
    setError("");
    api
      .get(slug, controller.signal)
      .then((detail) => {
        if (controller.signal.aborted) return;
        setCommunity(detail);
        setState("ready");
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        if (cause instanceof UiError && (cause.code === "NOT_FOUND" || cause.code === "ENDPOINT_UNAVAILABLE")) return setState("missing");
        setError(messageOf(cause));
        setState("error");
      });
    return () => controller.abort();
    // Giriş/çıkış sonrası izleyiciye özgü alan (viewer.role) yeniden okunur.
  }, [api, slug, attempt, user?.id]);

  const feedLoad = useCallback(
    (cursor: string | undefined, signal: AbortSignal) => api!.feed(community!.id, cursor, signal),
    [api, community?.id],
  );
  const feed = usePaged<Poll>(api && community ? feedLoad : null);

  async function toggle() {
    if (!api || !community || busy) return;
    if (!requireUser(`/topluluk/${slug}`)) return;
    setBusy(true);
    setError("");
    try {
      if (community.viewer?.role) await api.leave(community.id);
      else await api.join(community.id);
      notify(community.viewer?.role ? "Topluluktan ayrıldın." : "Topluluğa katıldın.");
      if (alive.current) retry((n) => n + 1);
    } catch (cause) {
      if (alive.current) setError(messageOf(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  if (!api) {
    return (
      <section className="kv-card kv-state">
        <h1>Topluluk</h1>
        <p className="kv-muted">Topluluk sayfaları demo veri kipinde gösterilmez; gerçek API ile açılır.</p>
      </section>
    );
  }
  if (state === "loading") return <Loading label="Topluluk yükleniyor…" />;
  if (state === "missing") {
    return (
      <section className="kv-card kv-state">
        <h1>Topluluk bulunamadı.</h1>
        <p className="kv-muted">Bu topluluk kapatılmış ya da hiç var olmamış olabilir.</p>
        <Link className="kv-button" href="/topluluklar">Topluluklara dön</Link>
      </section>
    );
  }
  if (state === "error" || !community) {
    return (
      <section className="kv-card kv-state">
        <h1>Topluluk açılamadı.</h1>
        <ErrorMessage message={error} />
        <button className="kv-button" onClick={() => retry((n) => n + 1)}>Tekrar dene</button>
      </section>
    );
  }

  const role = community.viewer?.role ?? null;
  return (
    <div className="screen-stack">
      <section className="kv-card kv-stack">
        <div className="kv-row kv-between">
          <div>
            <span className="eyebrow">TOPLULUK</span>
            <h1>{community.name}</h1>
          </div>
          <span className="kv-badge kv-badge--neutral">{community.memberCount} üye</span>
        </div>
        {community.description ? <p className="kv-muted">{community.description}</p> : null}
        <div className="kv-row">
          <button className={role ? "kv-button kv-button--secondary" : "kv-button"} onClick={() => void toggle()} disabled={busy} aria-pressed={role !== null}>
            {busy ? "İşleniyor…" : role ? "Topluluktan ayrıl" : "Topluluğa katıl"}
          </button>
          {role ? <span className="kv-badge kv-badge--neutral">{roleLabels[role]}</span> : null}
        </div>
        <ErrorMessage message={error} />
      </section>

      <section className="screen-stack" aria-labelledby="community-feed">
        <h2 id="community-feed">Topluluktaki sorular</h2>
        {feed.loading ? <Loading label="Gönderiler yükleniyor…" /> : null}
        {feed.error ? (
          <div className="kv-card kv-state">
            <ErrorMessage message={messageOf(feed.error)} />
            <button className="kv-button kv-button--secondary" onClick={feed.retry}>Tekrar dene</button>
          </div>
        ) : null}
        {!feed.loading && !feed.error && feed.items.length === 0 ? (
          <div className="kv-card kv-state"><p className="kv-muted">Bu toplulukta henüz gönderi yok.{role ? "" : " Katılıp ilk soruyu sen sorabilirsin."}</p></div>
        ) : null}
        {feed.items.map((poll) => <PollCard key={poll.id} poll={poll} />)}
        {feed.hasMore ? (
          <button className="kv-button kv-button--secondary" onClick={feed.loadMore} disabled={feed.more}>
            {feed.more ? "Yükleniyor…" : "Daha fazla göster"}
          </button>
        ) : null}
      </section>

      <Members community={community} />
    </div>
  );
}
