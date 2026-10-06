"use client";
import { useEffect, useRef, useState } from "react";
import { useProduct } from "../../components/product-provider";
import { ErrorMessage, Loading } from "../../components/fields";
import type { Poll } from "../../lib/model";
import { ReportButton } from "../community/report-dialog";
import { emptyCommentDraft, reactionAfter } from "./model";
import type { Comment, Engagement, Reaction, ReactionSummary } from "./model";

function Reactions({
  value,
  disabled,
  label,
  onChange,
}: {
  value: ReactionSummary;
  disabled: boolean;
  label: string;
  onChange: (next: Reaction) => void;
}) {
  return (
    <div className="reaction-row" role="group" aria-label={label}>
      {(["like", "dislike"] as const).map((type) => (
        <button
          key={type}
          type="button"
          className="reaction-button"
          disabled={disabled}
          aria-pressed={value.own === type}
          onClick={() => onChange(value.own === type ? null : type)}
        >
          <span aria-hidden="true">{type === "like" ? "↑" : "↓"}</span>
          {type === "like" ? "Beğen" : "Beğenme"}{" "}
          <strong>{type === "like" ? value.likes : value.dislikes}</strong>
        </button>
      ))}
    </div>
  );
}

export function SocialPanel({ poll }: { poll: Poll }) {
  const { client, user, requireUser, notify, commentDrafts, setCommentDraft } =
    useProduct();
  const [data, setData] = useState<Engagement | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"comment" | "alternative">("comment");
  const [limit, setLimit] = useState(4);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<string | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const deleteTrigger = useRef<HTMLElement | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const key = `${user?.id || "guest"}:${poll.id}`;
  const draft = commentDrafts[key] || emptyCommentDraft();
  const locked = poll.status === "LOCKED";
  const canComment = !locked && poll.commentsEnabled;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setData(null);
    setLoadError("");
    client
      .getEngagement(poll.id, controller.signal)
      .then((next) => {
        if (active) setData(next);
      })
      .catch((e) => {
        if (active) setLoadError(e.message);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [client, poll.id, user?.id, attempt]);
  useEffect(() => {
    if (deleting) dialog.current?.showModal();
    else dialog.current?.close();
  }, [deleting]);

  async function mutate(
    optimistic: Engagement,
    action: () => Promise<Engagement>,
    message: string,
  ) {
    if (lock.current || !data || !requireUser(`/karar/${poll.id}`))
      return false;
    const before = data;
    lock.current = true;
    setBusy(true);
    setError("");
    setData(optimistic);
    try {
      const next = await action();
      if (alive.current) {
        setData(next);
        notify(message);
      }
      return alive.current;
    } catch (e) {
      if (alive.current) {
        setData(before);
        setError(
          `${(e as Error).message} Görünüm yenilenmedi; işlemin durumunu kontrol edip tekrar deneyebilirsin.`,
        );
      }
      return false;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function react(commentId: string | null, next: Reaction) {
    if (!data) return;
    const optimistic = commentId
      ? {
          ...data,
          comments: data.comments.map((c) =>
            c.id === commentId
              ? { ...c, reaction: reactionAfter(c.reaction, next) }
              : c,
          ),
        }
      : { ...data, reaction: reactionAfter(data.reaction, next) };
    void mutate(
      optimistic,
      () => client.react(poll.id, commentId, next),
      next ? "Tepkin kaydedildi." : "Tepkin kaldırıldı.",
    );
  }
  async function send() {
    if (!data || lock.current) return;
    if (!draft.text.trim() || draft.text.trim().length > 2000) {
      setError("Yorum 1–2.000 karakter arasında olmalı.");
      input.current?.focus();
      return;
    }
    if (!requireUser(`/karar/${poll.id}`)) return;
    const fingerprint = JSON.stringify(draft);
    if (request.current?.fingerprint !== fingerprint)
      request.current = { fingerprint, id: crypto.randomUUID() };
    const temporary: Comment = {
      id: "pending",
      author: user!.name,
      text: draft.text.trim(),
      kind: draft.kind,
      parentId: draft.parentId,
      createdAt: new Date().toISOString(),
      edited: false,
      deleted: false,
      canEdit: false,
      reaction: { likes: 0, dislikes: 0, own: null },
    };
    setTab(
      draft.parentId
        ? data.comments.find((c) => c.id === draft.parentId)?.kind || "comment"
        : draft.kind,
    );
    setLimit(data.comments.length + 1);
    const saved = await mutate(
      { ...data, comments: [...data.comments, temporary] },
      () => client.addComment(poll.id, draft, request.current!.id),
      "Yorumun paylaşıldı. Yayın puanın değişmedi.",
    );
    if (saved) {
      setCommentDraft(key, emptyCommentDraft());
      request.current = null;
      input.current?.focus();
    }
  }
  function reply(c: Comment) {
    setCommentDraft(key, { ...draft, parentId: c.id, kind: "comment" });
    input.current?.focus();
  }
  async function saveEdit() {
    if (!data || !editing) return;
    if (!editing.text.trim() || editing.text.trim().length > 2000) {
      setError("Yorum 1–2.000 karakter arasında olmalı.");
      return;
    }
    const saved = await mutate(
      {
        ...data,
        comments: data.comments.map((c) =>
          c.id === editing.id
            ? { ...c, text: editing.text.trim(), edited: true }
            : c,
        ),
      },
      () => client.editComment(poll.id, editing.id, editing.text),
      "Yorumun güncellendi.",
    );
    if (saved) {
      setEditing(null);
      heading.current?.focus();
    }
  }
  function cancelDelete() {
    setDeleting(null);
    deleteTrigger.current?.focus();
  }
  async function confirmDelete() {
    if (!data || !deleting) return;
    const id = deleting;
    setDeleting(null);
    heading.current?.focus();
    await mutate(
      {
        ...data,
        comments: data.comments.map((c) =>
          c.id === id ? { ...c, deleted: true, text: "", canEdit: false } : c,
        ),
      },
      () => client.deleteComment(poll.id, id),
      "Yorumun silindi. Yanıtlar korunuyor.",
    );
  }
  function renderComment(c: Comment) {
    return (
      <article
        key={c.id}
        className={`social-comment ${c.parentId ? "social-reply" : ""}`}
        aria-label={c.deleted ? "Silinmiş yorum" : `${c.author} yorumu`}
      >
        {c.deleted ? (
          <p className="kv-muted">Bu yorum silindi.</p>
        ) : (
          <>
            <div className="kv-row kv-between">
              <strong>{c.author}</strong>
              <span className="kv-help">
                {c.edited
                  ? "Düzenlendi"
                  : c.kind === "alternative"
                    ? "Alternatif öneri"
                    : "Yorum"}
              </span>
            </div>
            {editing?.id === c.id ? (
              <form
                className="screen-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveEdit();
                }}
              >
                <div className="kv-field">
                  <label htmlFor="comment-edit">Yorumu düzenle</label>
                  <textarea
                    id="comment-edit"
                    className="kv-input"
                    autoFocus
                    maxLength={2000}
                    value={editing.text}
                    disabled={busy}
                    onChange={(e) =>
                      setEditing({ ...editing, text: e.target.value })
                    }
                  />
                </div>
                <div className="social-actions">
                  <button className="kv-button" disabled={busy}>
                    Değişikliği kaydet
                  </button>
                  <button
                    type="button"
                    className="kv-button kv-button--ghost"
                    disabled={busy}
                    onClick={() => {
                      setEditing(null);
                      heading.current?.focus();
                    }}
                  >
                    Vazgeç
                  </button>
                </div>
              </form>
            ) : (
              <p className="comment-text">{c.text}</p>
            )}
            <Reactions
              label={`${c.author} yorumuna tepki`}
              value={c.reaction}
              disabled={busy || locked}
              onChange={(v) => react(c.id, v)}
            />
            <div className="social-actions">
              {!c.parentId && canComment && (
                <button
                  className="kv-button kv-button--ghost"
                  disabled={busy}
                  onClick={() => reply(c)}
                >
                  Yanıtla
                </button>
              )}
              {!c.canEdit && <ReportButton target={{ type: "COMMENT", id: c.id }} label={`${c.author} yorumunu raporla`} />}
              {c.canEdit && (
                <>
                  <button
                    className="kv-button kv-button--ghost"
                    disabled={busy}
                    onClick={() => setEditing({ id: c.id, text: c.text })}
                  >
                    Düzenle
                  </button>
                  <button
                    className="kv-button kv-button--ghost"
                    disabled={busy}
                    onClick={(e) => {
                      deleteTrigger.current = e.currentTarget;
                      setDeleting(c.id);
                    }}
                  >
                    Sil
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </article>
    );
  }
  if (loadError)
    return (
      <section className="kv-card screen-stack" aria-label="Yorumlar">
        <h2>Yorumlar yüklenemedi.</h2>
        <ErrorMessage message={loadError} />
        <button className="kv-button" onClick={() => retry((n) => n + 1)}>
          Yorumları tekrar yükle
        </button>
      </section>
    );
  if (!data) return <Loading label="Yorumlar yükleniyor…" />;
  const roots = data.comments
    .filter((c) => !c.parentId && c.kind === tab)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const parent = data.comments.find((c) => c.id === draft.parentId);
  return (
    <section
      className="kv-card screen-stack social-panel"
      aria-labelledby="comments-title"
      aria-busy={busy}
    >
      <div className="kv-row kv-between">
        <span className="eyebrow">FİKRİNİ PAYLAŞ</span>
        <span className="kv-help">
          {data.comments.filter((c) => !c.deleted).length} yorum / öneri
        </span>
      </div>
      <h2 id="comments-title" tabIndex={-1} ref={heading}>
        Yorumlar
      </h2>
      <Reactions
        label="Gönderiye tepki"
        value={data.reaction}
        disabled={busy || locked}
        onChange={(v) => react(null, v)}
      />
      <p className="kv-help">
        Beğeni ve beğenmeme, anket oyundan ayrıdır. Yorum ve tepkiler puan
        harcamaz.
      </p>
      <ErrorMessage message={error} />
      {busy && (
        <p role="status" className="kv-help">
          Değişiklik kaydediliyor…
        </p>
      )}
      {canComment ? (
        <form
          className="comment-composer screen-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div
            className="social-actions"
            role="group"
            aria-label="Paylaşım türü"
          >
            <button
              type="button"
              className="reaction-button"
              disabled={busy}
              aria-pressed={draft.kind === "comment"}
              onClick={() =>
                setCommentDraft(key, {
                  ...draft,
                  kind: "comment",
                  parentId: null,
                })
              }
            >
              Yorum yaz
            </button>
            <button
              type="button"
              className="reaction-button"
              disabled={busy}
              aria-pressed={draft.kind === "alternative"}
              onClick={() =>
                setCommentDraft(key, {
                  ...draft,
                  kind: "alternative",
                  parentId: null,
                })
              }
            >
              Alternatif öner
            </button>
          </div>
          {draft.parentId && (
            <div className="reply-target">
              <span>
                {parent?.deleted
                  ? "Silinmiş yoruma yanıt verilemez."
                  : `${parent?.author || "Seçili yorum"} için yanıt yazıyorsun.`}
              </span>
              <button
                type="button"
                className="kv-button kv-button--ghost"
                disabled={busy}
                onClick={() =>
                  setCommentDraft(key, { ...draft, parentId: null })
                }
              >
                Yanıtı iptal et
              </button>
            </div>
          )}
          <label className="kv-field" htmlFor="comment-draft">
            {draft.kind === "alternative"
              ? "Alternatif önerin"
              : draft.parentId
                ? "Yanıtın"
                : "Yorumun"}
          </label>
          <textarea
            id="comment-draft"
            ref={input}
            className="kv-input"
            value={draft.text}
            maxLength={2000}
            rows={4}
            disabled={busy}
            aria-describedby="comment-help"
            placeholder="Deneyimini, nedenini veya farklı bir seçeneği paylaş…"
            onChange={(e) =>
              setCommentDraft(key, { ...draft, text: e.target.value })
            }
          />
          <div className="kv-row kv-between">
            <span id="comment-help" className="kv-help">
              {draft.text.length}/2000 · Sayfa yenilenene kadar korunur.
            </span>
            <button
              className="kv-button"
              disabled={busy || Boolean(parent?.deleted)}
            >
              {busy ? "Kaydediliyor…" : "Paylaş"}
            </button>
          </div>
        </form>
      ) : (
        <p className="private-results">
          {locked
            ? "Bu içerik kilitli; yorumlar okunabilir, etkileşimler kapalı."
            : "Bu içerikte yorumlar kapalı."}
        </p>
      )}
      <div className="social-actions" role="group" aria-label="Yorum filtresi">
        <button
          className="reaction-button"
          aria-pressed={tab === "comment"}
          onClick={() => {
            setTab("comment");
            setLimit(4);
          }}
        >
          Yorumlar (
          {
            data.comments.filter(
              (c) => !c.parentId && c.kind === "comment" && !c.deleted,
            ).length
          }
          )
        </button>
        <button
          className="reaction-button"
          aria-pressed={tab === "alternative"}
          onClick={() => {
            setTab("alternative");
            setLimit(4);
          }}
        >
          Alternatifler (
          {
            data.comments.filter((c) => c.kind === "alternative" && !c.deleted)
              .length
          }
          )
        </button>
      </div>
      {roots.length ? (
        roots.slice(0, limit).map((c) => (
          <div key={c.id} className="comment-thread">
            {renderComment(c)}
            {data.comments
              .filter((reply) => reply.parentId === c.id)
              .map(renderComment)}
          </div>
        ))
      ) : (
        <p className="kv-muted">
          {tab === "alternative"
            ? "Henüz alternatif önerilmedi. Farklı bir fikrin varsa paylaş."
            : "Henüz yorum yok. İlk fikri sen paylaş."}
        </p>
      )}
      {roots.length > limit && (
        <button
          className="kv-button kv-button--secondary"
          onClick={() => setLimit((n) => n + 4)}
        >
          Daha fazla göster ({roots.length - limit})
        </button>
      )}
      {data.hasMore && client.loadMoreEngagement && <button className="kv-button kv-button--secondary" disabled={busy} onClick={async () => {
        if (lock.current) return;
        lock.current=true; setBusy(true); setError("");
        try { const next=await client.loadMoreEngagement!(poll.id); if (alive.current) { setData(next); setLimit(n=>n+20); } }
        catch (error) { if (alive.current) setError((error as Error).message); }
        finally { lock.current=false; if (alive.current) setBusy(false); }
      }}>Diğer yorum ve yanıtları yükle</button>}
      <dialog
        ref={dialog}
        className="kv-dialog"
        aria-labelledby="delete-title"
        aria-describedby="delete-description"
        onCancel={cancelDelete}
        onClose={() => setDeleting(null)}
      >
        <div className="screen-stack">
          <h2 id="delete-title">Yorumu silmek istiyor musun?</h2>
          <p id="delete-description">
            Yorum metnin kaldırılır. Altındaki yanıtlar korunur.
          </p>
          <button
            className="kv-button kv-button--secondary"
            autoFocus
            onClick={cancelDelete}
          >
            Vazgeç
          </button>
          <button className="kv-button" onClick={() => void confirmDelete()}>
            Yorumu sil
          </button>
        </div>
      </dialog>
    </section>
  );
}
