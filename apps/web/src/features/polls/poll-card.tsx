"use client";
import Link from "next/link";
import type { Poll } from "../../lib/model";
export function PollCard({ poll }: { poll: Poll }) {
  return (
    <article className="kv-card poll-card">
      <div className="kv-row kv-between">
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
          {poll.commentCount ?? poll.comments.length} yorum / öneri
        </span>
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
