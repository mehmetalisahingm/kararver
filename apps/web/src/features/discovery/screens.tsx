"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import surfaces from "../../components/content-surfaces.module.css";
import { useRouter } from "next/navigation";
import { useProduct } from "../../components/product-provider";
import { ErrorMessage, Loading } from "../../components/fields";
import { PollCard } from "../polls/poll-card";
import { IllustratedScene, visualTopic } from "../../components/visual-story";
import { TopicShowcase } from "../../components/topic-showcase";
import { ResultChart } from "./charts";
import { usePages } from "./use-pages";
import { dateLabel, feedTabs, formats, queryUrl, searchTypes } from "./model";
import type {
  Category,
  Query,
  FeedTab,
  Page,
  SearchResult,
  SearchType,
  TrendFormat,
  TrendItem,
  TrendPage,
} from "./model";
function DiscoveryNav({
  current,
}: {
  current: "feed" | "categories" | "trends";
}) {
  return (
    <nav className="discovery-nav" aria-label="Keşif bölümleri">
      <Link
        href="/kesfet"
        aria-current={current === "feed" ? "page" : undefined}
      >
        Keşfet
      </Link>
      <Link
        href="/kategoriler"
        aria-current={current === "categories" ? "page" : undefined}
      >
        Kategoriler
      </Link>
      <Link
        href="/yukselenler"
        aria-current={current === "trends" ? "page" : undefined}
      >
        Yükselenler
      </Link>
    </nav>
  );
}
function useQueryFocus(query: Query, home = false, mission = false) {
  const key = JSON.stringify(query);
  const previous = useRef(key);
  useEffect(() => {
    if (previous.current !== key)
      document.querySelector<HTMLElement>(home ? "#home-feed" : mission ? "#mission-content" : "#main")?.focus({ preventScroll: home || mission });
    previous.current = key;
  }, [key, home, mission]);
}
function useCategories() {
  const { client } = useProduct();
  const [data, setData] = useState<Category[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    client
      .getCategories(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setData(next);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [client, attempt]);
  return { data, error, retry: () => retry((n) => n + 1) };
}
function SearchForm({ query, preserveScroll = false }: { query: Query; preserveScroll?: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(query.q);
  const [type, setType] = useState<SearchType>(query.type);
  const [error, setError] = useState("");
  return (
    <form
      className="discovery-search kv-card"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim().length < 2 || text.trim().length > 100) {
          setError("Arama 2–100 karakter arasında olmalı.");
          return;
        }
        setError("");
        router.push(
          queryUrl("/kesfet", query, { q: text.trim(), type, category: "" }),
          { scroll: !preserveScroll },
        );
      }}
    >
      <div className="search-fields">
        <div className="kv-field">
          <label htmlFor="discover-query">Ne hakkında düşünüyorsun?</label>
          <input
            id="discover-query"
            className="kv-input"
            type="search"
            maxLength={100}
            value={text}
            placeholder="Bir konu, kişi veya topluluk ara…"
            onChange={(e) => setText(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "search-error" : undefined}
          />
        </div>
        <div className="kv-field">
          <label htmlFor="search-type">Arama alanı</label>
          <select
            id="search-type"
            className="kv-input"
            value={type}
            onChange={(e) => setType(e.target.value as SearchType)}
          >
            {Object.entries(searchTypes).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button className="kv-button">Ara</button>
      </div>
      {error && (
        <p id="search-error" className="error-message" role="alert">
          {error}
        </p>
      )}
      {query.q && (
        <Link className="back-link" href="/kesfet">
          Aramayı temizle
        </Link>
      )}
    </form>
  );
}
function CategoryFilter({
  categories,
  query,
  path,
  navigate,
}: {
  categories: Category[];
  query: Query;
  path: string;
  navigate?: (url: string) => void;
}) {
  const router = useRouter();
  return (
    <div className="kv-field category-filter">
      <label htmlFor="discovery-category">Kategori</label>
      <select
        id="discovery-category"
        className="kv-input"
        value={query.category}
        onChange={(e) =>
          (navigate || router.push)(
            queryUrl(path, query, { category: e.target.value }),
          )
        }
      >
        <option value="">Tüm kategoriler</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
function PageActions({
  error,
  busy,
  hasMore,
  more,
  refresh,
}: {
  error: { message: string; invalidCursor: boolean } | null;
  busy: boolean;
  hasMore: boolean;
  more: () => void;
  refresh: () => void;
}) {
  return (
    <div className="page-actions">
      {error && (
        <div className="kv-card screen-stack">
          <ErrorMessage message={error.message} />
          <button
            className="kv-button kv-button--secondary"
            onClick={error.invalidCursor ? refresh : more}
            disabled={busy}
          >
            {error.invalidCursor ? "Listeyi baştan yükle" : "Tekrar dene"}
          </button>
        </div>
      )}
      {hasMore && !error && (
        <button
          className="kv-button kv-button--secondary"
          disabled={busy}
          aria-busy={busy}
          onClick={more}
        >
          {busy ? "Devamı yükleniyor…" : "Daha fazla göster"}
        </button>
      )}
    </div>
  );
}
function CategoryError({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div className="kv-card screen-stack">
      <ErrorMessage message={message} />
      <button className="kv-button" onClick={retry}>
        Kategorileri tekrar yükle
      </button>
    </div>
  );
}
function SearchCard({ item }: { item: SearchResult }) {
  if (item.type === "poll") return <PollCard poll={item.poll} />;
  if (item.type === "category")
    return (
      <article className="kv-card search-summary">
        <span className="eyebrow">KATEGORİ</span>
        <h2>
          <Link href={`/kategori/${item.category.slug}`}>
            {item.category.name}
          </Link>
        </h2>
        <p className="kv-muted">{item.category.description}</p>
      </article>
    );
  if (item.type === "user")
    return (
      <article className="kv-card search-summary">
        <span className="eyebrow">KULLANICI</span>
        <h2><Link href={`/profil/${encodeURIComponent(item.user.username)}`}>{item.user.displayName}</Link></h2>
        <p>@{item.user.username}</p>
        <p className="kv-help">Herkese açık kullanıcı özeti.</p>
      </article>
    );
  return (
    <article className="kv-card search-summary">
      <span className="eyebrow">TOPLULUK</span>
      <h2>
        <Link href={`/topluluk/${item.community.slug}`}>{item.community.name}</Link>
      </h2>
      <p className="kv-help">Topluluk sayfasında soruları ve üyeleri gör.</p>
    </article>
  );
}
function resultKey(item: SearchResult) {
  return (
    item.type +
    ":" +
    (item.type === "poll"
      ? item.poll.id
      : item.type === "category"
        ? item.category.id
        : item.type === "user"
          ? item.user.id
          : item.community.id)
  );
}

function FeedBody({
  query,
  home,
  category,
  categories,
}: {
  query: Query;
  home?: boolean;
  category?: Category;
  categories: Category[];
}) {
  const { client, user } = useProduct();
  const path = category ? `/kategori/${category.slug}` : home ? "/" : "/kesfet";
  const router = useRouter();
  const load = useCallback(
    async (
      cursor: string | undefined,
      signal: AbortSignal,
    ): Promise<Page<SearchResult>> => {
      if (query.q) return client.search(query.q, query.type, cursor, signal);
      const response = await client.getFeed(
        query.tab,
        category?.id || query.category || undefined,
        cursor,
        signal,
      );
      return {
        data: response.data.map((poll) => ({ type: "poll" as const, poll })),
        page: response.page,
      };
    },
    [
      client,
      query.q,
      query.type,
      query.tab,
      query.category,
      category?.id,
      user?.id,
    ],
  );
  const pages = usePages<SearchResult, Page<SearchResult>>(load);
  const questions = pages.result?.data.filter((item): item is Extract<SearchResult, { type: "poll" }> => item.type === "poll") ?? [];
  return (
    <>
      {(!home || query.q) && <SearchForm query={query} preserveScroll={!home && !category} />}
      {query.q ? (
        <p className="kv-muted">
          “{query.q}” · {searchTypes[query.type]} sonuçları
        </p>
      ) : (
        <>
          <div className="feed-filters">
            <nav className="feed-tabs" aria-label="Akış sıralaması">
              {Object.entries(feedTabs).map(([value, label]) => (
                <Link
                  key={value}
                  href={queryUrl(path, query, { tab: value as FeedTab })}
                  scroll={!home}
                  aria-current={query.tab === value ? "page" : undefined}
                >
                  {label}
                </Link>
              ))}
            </nav>
            {!category && (
              <CategoryFilter
                categories={categories}
                query={query}
                path={path}
                navigate={home || !category ? url => router.push(url, { scroll: false }) : undefined}
              />
            )}
          </div>
          <p className="kv-help">
            İçerikleri keşfet ·{" "}
            {query.tab === "for_you"
              ? "Popüler ve yeni içerikleri birlikte keşfet."
              : query.tab === "new"
                ? "Yeni içeriklere göz at."
                : "Çok oy alan içerikler."}{" "}
            
          </p>
        </>
      )}
      {home && questions.length > 1 && <div className="home-surprise"><p>Bir yerden başlamak yeter.</p><button type="button" onClick={() => {
        const poll = questions[Math.floor(Math.random() * questions.length)].poll;
        router.push(poll.canonicalPath || `/karar/${poll.id}`);
      }}>Beni şaşırt ↗</button></div>}
      {!pages.result && pages.busy && (
        <Loading
          label={query.q ? "Arama sonuçları yükleniyor…" : "Akış yükleniyor…"}
        />
      )}
      {pages.result && (
        <>
          <p className="sr-only" role="status">
            {pages.result.data.length} sonuç gösteriliyor.
          </p>
          {pages.result.data.length ? (
            <div className="screen-stack discovery-results">
              {pages.result.data.map((item) => (
                <SearchCard key={resultKey(item)} item={item} />
              ))}
            </div>
          ) : (
            <div className="kv-card kv-state kv-illustrated-empty">
              <IllustratedScene topic="conversation" />
              <h2>Burada henüz bir eşleşme yok.</h2>
              <p className="kv-muted">
                {query.q
                  ? "Farklı bir kelime veya arama alanı deneyebilirsin."
                  : "Başka bir kategoriye göz atabilir veya ilk soruyu sen sorabilirsin."}
              </p>
              <Link href="/kesfet" className="kv-button kv-button--secondary">
                Tüm içeriklere dön
              </Link>
            </div>
          )}
        </>
      )}
      <PageActions
        error={pages.error}
        busy={pages.busy}
        hasMore={Boolean(pages.result?.page.hasMore)}
        more={pages.result ? pages.more : pages.refresh}
        refresh={pages.refresh}
      />
    </>
  );
}
export function DiscoveryScreen({
  query,
  home,
  categorySlug,
}: {
  query: Query;
  home?: boolean;
  categorySlug?: string;
}) {
  const mission = !home && !categorySlug;
  useQueryFocus(query, home, mission);
  const { user } = useProduct();
  const categories = useCategories();
  const category = categories.data?.find((c) => c.slug === categorySlug);
  if (home) return <div className="home-discovery">
    <TopicShowcase categories={categories.data ?? []} />
    <section className="home-feed" id="home-feed" tabIndex={-1} aria-labelledby="home-feed-title">
      <header className="home-feed-header"><div><span className="eyebrow">03 — SENİN MASAN</span><h2 id="home-feed-title" aria-label="Bugünün kararları">Bugünün<br />kararları</h2></div><Link href="/olustur">Bir soru bırak ↗</Link></header>
      {categories.error ? <CategoryError message={categories.error} retry={categories.retry} /> : !categories.data ? <Loading label="Kategoriler yükleniyor…" /> : <FeedBody key={JSON.stringify(query) + (user?.id || "guest")} query={query} home categories={categories.data} />}
      <Link className="home-all-questions" href="/kesfet">Tüm sorulara göz at ↗</Link>
    </section>
  </div>;
  return (
    <div className={`screen-stack ${surfaces.screen}${mission ? " mission-discovery" : ""}`}>
      <DiscoveryNav current={categorySlug ? "categories" : "feed"} />
      {mission ? <>
        <header className="mission-directory-heading"><div><span className="eyebrow">YENİ BİR BAKIŞ AÇISI</span><h2>{query.q ? "Arama sonuçları" : "Keşif masası"}</h2></div><p>Bir konu bul. Bir soru aç.<br />Düşündüğünü söyle.</p></header>
        {!query.q && <nav className="mission-category-links" aria-label="Keşif konuları">{categories.data?.slice(0,8).map(item => <Link key={item.id} href={"/kategori/" + item.slug}>{item.name} ↗</Link>)}</nav>}
      </> : <div className="discovery-hero kv-immersive-hero">
        <div className="kv-hero-copy">
          <span className="eyebrow">KARARVER · FİKİRLERİN BULUŞMA NOKTASI</span>
          <h1>{query.q ? "Arama sonuçları" : categorySlug ? category?.name || "Kategori" : home ? <>Her soru <em>bir hikâye.</em></> : "Keşfet"}</h1>
          <p>{category?.description || "Sor, keşfet, başkalarının ne düşündüğünü gör. Bir fikrin varsa burada hayat bulsun."}</p>
          {!query.q && !categorySlug && (
            <div className="kv-hero-actions">
              <Link href="/olustur" className="kv-button">Bir soru sor ↗</Link>
              <Link href="/kategoriler" className="kv-hero-link">Konuları keşfet</Link>
            </div>
          )}
        </div>

      </div>}
      {categorySlug && (
        <Link href="/kategoriler" className="back-link">
          ← Tüm kategoriler
        </Link>
      )}
      {categories.error ? (
        <CategoryError message={categories.error} retry={categories.retry} />
      ) : !categories.data ? (
        <Loading label="Kategoriler yükleniyor…" />
      ) : categorySlug && !category ? (
        <div className="kv-card kv-state">
          <h2>Kategori bulunamadı.</h2>
          <Link href="/kategoriler">Kategorilere dön</Link>
        </div>
      ) : (
        <FeedBody
          key={JSON.stringify(query) + categorySlug + (user?.id || "guest")}
          query={query}
          home={home}
          category={category}
          categories={categories.data}
        />
      )}
    </div>
  );
}
export function CategoryDirectory() {
  const categories = useCategories();
  return (
    <div className={`screen-stack ${surfaces.screen}`}>
      <DiscoveryNav current="categories" />
      <div className="discovery-hero kv-immersive-hero">
        <div className="kv-hero-copy">
          <span className="eyebrow">BİRBİRİNDEN FARKLI DÜNYALAR</span>
          <h1>Kategoriler</h1>
          <p>Teknolojiden sanata, spordan günlük hayata… Bir konuyu seç, fikirlere dal.</p>
        </div>

      </div>
      {categories.error ? (
        <CategoryError message={categories.error} retry={categories.retry} />
      ) : !categories.data ? (
        <Loading label="Kategoriler yükleniyor…" />
      ) : (
        <div className="category-grid">
          {categories.data.map((category) => (
            <Link href={"/kategori/" + category.slug} key={category.id} className="kv-card category-tile kv-category-illustrated">
              <div className="kv-category-art"><IllustratedScene topic={visualTopic(category.name)} /></div>
              <div className="kv-category-copy">
                <h2>{category.name}</h2>
                <p>{category.description}</p>
                <span className="category-open">Konuları keşfet <span aria-hidden="true">↗</span></span>
              </div>
            </Link>
          ))}
        </div>
      )}
      {categories.data?.length === 0 && (
        <div className="kv-card kv-state kv-illustrated-empty"><IllustratedScene topic="conversation" /><p>Henüz aktif kategori yok.</p></div>
      )}
    </div>
  );
}
const trendDescriptions: Record<TrendFormat, string> = {
  DAILY_RISING: "Günün dikkat çeken soruları ve yeni tartışmaları.",
  WEEKLY_RISING: "Bu hafta topluluğun ilgisini yükselten kararlar.",
  WEEKLY_MOST_VOTED: "Hafta boyunca en çok oy verilen anketler.",
  WEEKLY_MOST_DISCUSSED: "Fikirlerin ve yanıtların buluştuğu konuşmalar.",
  WEEKLY_MOVERS: "İki haftanın sonunda seçenek tercihleri nasıl değişti?",
};
function TrendBody({
  query,
  categories,
}: {
  query: Query;
  categories: Category[];
}) {
  const { client, user } = useProduct();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const navigate = (url: string) => startTransition(() => router.push(url));
  const load = useCallback(
    (cursor: string | undefined, signal: AbortSignal) =>
      client.getTrends(
        query.format,
        query.category || undefined,
        cursor,
        signal,
      ),
    [client, query.format, query.category, user?.id],
  );
  const pages = usePages<TrendItem, TrendPage>(load);
  const meta = pages.result?.meta;
  return (
    <>
      <fieldset
        className="trend-filters"
        disabled={pending}
        aria-busy={pending}
      >
        <legend className="sr-only">Trend filtreleri</legend>
        <div className="kv-field">
          <label htmlFor="discovery-format">Trend görünümü</label>
          <select
            id="discovery-format"
            className="kv-input"
            value={query.format}
            onChange={(e) =>
              navigate(
                queryUrl("/yukselenler", query, {
                  format: e.target.value as TrendFormat,
                  q: "",
                }),
              )
            }
          >
            {Object.entries(formats).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <CategoryFilter
          categories={categories}
          query={query}
          path="/yukselenler"
          navigate={navigate}
        />
      </fieldset>
      <p className="kv-muted">{trendDescriptions[query.format]}</p>
      {meta && (
        <div className="trend-period">
          <span className="kv-badge">Hesaplama dönemi</span>
          <p>
            <strong>
              {dateLabel(meta.windowStart)} – {dateLabel(meta.windowEnd)}
            </strong>
            <br />
            <small>
              İstanbul saati · Hesaplama: {dateLabel(meta.computedAt)} · Sürüm{" "}
              {meta.calculationVersion}
            </small>
          </p>
        </div>
      )}
      {query.format === "WEEKLY_MOVERS" && (
        <details className="trend-explanation">
          <summary>Bu değişimi nasıl okumalıyım?</summary>
          <p>
            Karşılaştırma iki 7 günlük dönemin sonunu kullanır. Örneğin %35’ten
            %55’e geçiş +20 yüzde puandır. Bu, %20 göreli artış anlamına gelmez.
          </p>
          <p>
            Varsayılan veri eşiği her iki uçta en az 30 oy ve ikinci dönemde en
            az 10 benzersiz aktif hesaptır. Uygunluğu sunucu hesaplar; yeterli
            geçmişi olmayan içerikler listeye alınmaz.
          </p>
          <p>
            Sıralama puanı herkese açık sözleşmede yer almaz. Gösterilen değer,
            seçeneğin yüzde puan farkıdır. Tarihler ve örneklemler her grafiğin
            tablo görünümünde de bulunur.
          </p>
        </details>
      )}
      {!pages.result && pages.busy && <Loading label="Trendler yükleniyor…" />}
      {pages.result && (
        <>
          <p className="sr-only" role="status">
            {pages.result.data.length} trend gösteriliyor.
          </p>
          {pages.result.data.length ? (
            <>
            <section className="trend-galaxy" aria-labelledby="galaxy-title">
              <div className="trend-galaxy__intro"><span>GÜNDEMİN YÖRÜNGESİ</span><h2 id="galaxy-title">Fikirler burada<br />birbirine yaklaşır.</h2><p>Seçtiğin filtredeki ilk {Math.min(6, pages.result.data.length)} konuyu keşfet.</p></div>
              <div className="trend-galaxy__stars">
                {pages.result.data.slice(0, 6).map((item, index) => <Link className="trend-galaxy__star" href={item.poll.canonicalPath || `/karar/${item.poll.id}`} key={item.poll.id} style={{ "--star-index": index } as CSSProperties}><span aria-hidden="true" className="trend-galaxy__light" /><span className="trend-galaxy__label"><small>#{item.rank} · {item.poll.category}</small><strong>{item.poll.title}</strong></span></Link>)}
              </div>
            </section>
            <div className="screen-stack trend-results">
              {pages.result.data.map((item) => (
                <article key={item.poll.id} className="kv-card trend-card">
                  <div className="kv-trend-visual"><IllustratedScene topic={visualTopic(item.poll.category)} /></div>
                  <div className="trend-card-heading">
                    <span
                      className="rank-badge"
                      aria-label={`Genel sıralama ${item.rank}`}
                    >
                      {String(item.rank).padStart(2, "0")}
                    </span>
                    <div>
                      <Link
                        className="eyebrow"
                        href={categories.some((c) => c.name === item.poll.category) ? `/kategori/${categories.find((c) => c.name === item.poll.category)!.slug}` : "/kategoriler"}
                      >
                        {item.poll.category}
                      </Link>
                      <h2>
                        <Link href={item.poll.canonicalPath || `/karar/${item.poll.id}`}>
                          {item.poll.title}
                        </Link>
                      </h2>
                      <p className="kv-help">
                        {item.poll.author}
                      </p>
                    </div>
                  </div>
                  <ResultChart poll={item.poll} movement={item.movement} />
                  <Link href={item.poll.canonicalPath || `/karar/${item.poll.id}`} className="back-link">
                    {item.poll.kind === "discussion"
                      ? "Tartışmaya katıl"
                      : "Anketi incele"}{" "}
                    <span aria-hidden="true">→</span>
                  </Link>
                </article>
              ))}
            </div>
            </>
          ) : (
            <div className="kv-card kv-state kv-illustrated-empty">
              <IllustratedScene topic="conversation" />
              <h2>
                {pages.result.reason === "INSUFFICIENT_HISTORY"
                  ? "Karşılaştırma için yeterli geçmiş yok."
                  : "Bu kategoride henüz trend yok."}
              </h2>
              <p className="kv-muted">
                {pages.result.reason === "INSUFFICIENT_HISTORY"
                  ? "Eksik dönemler ve az oy içeren verilerle değişim hesaplanmaz. Başka bir kategoriyi inceleyebilirsin."
                  : "Farklı bir kategori veya trend görünümü seçebilirsin."}
              </p>
              <Link
                href={queryUrl("/yukselenler", query, { category: "" })}
                className="kv-button kv-button--secondary"
              >
                Kategori filtresini temizle
              </Link>
            </div>
          )}
        </>
      )}
      <PageActions
        error={pages.error}
        busy={pages.busy}
        hasMore={Boolean(pages.result?.page.hasMore)}
        more={pages.result ? pages.more : pages.refresh}
        refresh={pages.refresh}
      />
    </>
  );
}
export function TrendsScreen({ query }: { query: Query }) {
  useQueryFocus(query);
  const { user } = useProduct();
  const categories = useCategories();
  return (
    <div className={`screen-stack ${surfaces.screen}`}>
      <DiscoveryNav current="trends" />
      <div className="discovery-hero trend-hero kv-immersive-hero">
        <div className="kv-hero-copy">
          <span className="eyebrow">FİKİRLER DEĞİŞİYOR, GÜNDEM HAREKETLENİYOR</span>
          <h1>{formats[query.format]}</h1>
          <p>Gerçek oylar, gerçek eğilimler. Topluluğun nabzını burada keşfet.</p>
        </div>

      </div>
      {categories.error ? (
        <CategoryError message={categories.error} retry={categories.retry} />
      ) : !categories.data ? (
        <Loading label="Kategoriler yükleniyor…" />
      ) : (
        <TrendBody
          key={JSON.stringify(query) + (user?.id || "guest")}
          query={query}
          categories={categories.data}
        />
      )}
    </div>
  );
}
