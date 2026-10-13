"use client";
import Link from "next/link";
import type { Poll } from "../../lib/model";
import { PollCover } from "./poll-cover";
import styles from "./polls.module.css";
export function PollCard({ poll }: { poll: Poll }) {
  const cover=poll.gallery?.find(item=>item.status==="ready");
  const results=poll.results;
  const date=poll.createdAt && Number.isFinite(Date.parse(poll.createdAt)) ? new Intl.DateTimeFormat("tr-TR",{dateStyle:"medium",timeZone:"Europe/Istanbul"}).format(new Date(poll.createdAt)) : null;
  return (
    <article className={`kv-card poll-card ${styles.card}`}>
      <div className={styles.meta}>
        <div className="kv-row">
          <span className="avatar" aria-hidden="true">
            {poll.author[0]}
          </span>
          <span className="author">
            {poll.author}
            <small>{poll.category}</small>
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
        <Link href={poll.canonicalPath || `/karar/${poll.id}`}>{poll.title}</Link>
      </h2>
      {poll.description && <p className={`kv-muted ${styles.description}`}>{poll.description}</p>}
      {cover?.status==="ready" && <PollCover key={cover.src} src={cover.src} alt={cover.alt}/>}
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
      {poll.kind==="poll" && poll.options.length>0 && <ul className={styles.options} aria-label="Anket seçenekleri">
        {poll.options.map(option=>{
          const result=results.visible ? results.options.find(r=>r.id===option.id) : undefined;
          return <li className={styles.option} key={option.id} data-selected={poll.ownVote===option.id}>
            <div><span>{option.label}{poll.ownVote===option.id && <small> · Senin oyun</small>}</span>{result && <strong>%{result.percent}</strong>}</div>
            {result && <progress value={result.percent} max={100} aria-label={`${option.label} yüzde ${result.percent}`}/>}
          </li>;
        })}
      </ul>}
      {poll.kind==="poll" && !results.visible && <p className="kv-help">Sonuçlar oy verdikten sonra görünür.</p>}
      <div className={styles.footer}>
        <div className={styles.stats}>
          {date && <time dateTime={poll.createdAt}>{date}</time>}
          {poll.kind==="poll" && results.visible && <span>{results.total.toLocaleString("tr-TR")} oy</span>}
          <span>
          {poll.commentCount ?? poll.comments.length} yorum / öneri
          </span>
        </div>
        <Link
          className="kv-button kv-button--secondary"
          href={poll.canonicalPath || `/karar/${poll.id}`}
        >
          {poll.kind === "discussion" ? "Tartışmayı oku" : "Anketi incele"}
        </Link>
      </div>
    </article>
  );
}
