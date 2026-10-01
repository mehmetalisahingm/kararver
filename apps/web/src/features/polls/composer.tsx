"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useProduct } from "../../components/product-provider";
import { ApiClient } from "../../lib/api-client";
import { ErrorMessage, Field } from "../../components/fields";
import {
  categories,
  emptyDraft,
  UiError,
  validateDraft,
} from "../../lib/model";
import type { FieldErrors } from "../../lib/model";
export function Composer() {
  const { client, demo, draft, setDraft, user, syncUser, requireUser, notify } =
    useProduct();
  const router = useRouter();
  const [remoteCategories, setRemoteCategories] = useState<{id: string; name: string}[]>([]);
  const [categoryError, setCategoryError] = useState("");
  const [categoryAttempt, retryCategories] = useState(0);
  useEffect(() => {
    if (!(client instanceof ApiClient)) return;
    let active = true;
    setCategoryError("");
    client.publicationCategories().then(items => { if (active) setRemoteCategories(items); }).catch(error => { if (active) setCategoryError(error.message); });
    return () => { active = false; };
  }, [client, categoryAttempt]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);
  const request = useRef({ fingerprint: "", key: "" });
  const update = (change: Partial<typeof draft>) => {
    setDraft({ ...draft, ...change });
    setErrors({});
    setError("");
  };
  function review(event: FormEvent) {
    event.preventDefault();
    const next = validateDraft(draft);
    if (!demo && !remoteCategories.some(c => c.id === draft.categoryId)) next.category = "Geçerli bir kategori seçmelisin.";
    setErrors(next);
    if (Object.keys(next).length) {
      setTimeout(
        () => document.getElementById(Object.keys(next)[0])?.focus(),
        0,
      );
      return;
    }
    if (!requireUser("/olustur")) return;
    dialog.current?.showModal();
  }
  async function publish() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const fingerprint = JSON.stringify([user?.id, draft]);
    if (request.current.fingerprint !== fingerprint)
      request.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const poll = await client.create(draft, request.current.key);
      syncUser();
      setDraft(emptyDraft());
      dialog.current?.close();
      notify(demo ? "Demo içerik yayımlandı. Bakiyenden 10 örnek puan düşüldü." : "İçeriğin yayımlandı.");
      router.push(poll.canonicalPath || `/karar/${poll.id}`);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof UiError) setErrors(e.fields);
      dialog.current?.close();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="screen-stack">
      <div>
        <span className="eyebrow">BİR SORU, YENİ BAKIŞ AÇILARI</span>
        <h1>Aklında ne var?</h1>
        <p className="kv-muted">
          Bir anket aç veya seçenek eklemeden bir tartışma başlat.
        </p>
      </div>
      <form className="kv-card screen-stack" onSubmit={review} noValidate>
        <fieldset disabled={busy}>
          <legend>İçerik türü</legend>
          <div className="kind-switch">
            <label>
              <input
                type="radio"
                name="kind"
                value="poll"
                checked={draft.kind === "poll"}
                onChange={() => update({ kind: "poll" })}
              />{" "}
              Anket
            </label>
            <label>
              <input
                type="radio"
                name="kind"
                value="discussion"
                checked={draft.kind === "discussion"}
                onChange={() => update({ kind: "discussion" })}
              />{" "}
              Tartışma / soru
            </label>
          </div>
        </fieldset>
        <Field id="title" label="Sorun" error={errors.title}>
          <input
            className="kv-input"
            id="title"
            required
            maxLength={140}
            value={draft.title}
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? "title-error" : undefined}
            onChange={(e) => update({ title: e.target.value })}
          />
        </Field>
        <Field
          id="description"
          label="Açıklama (isteğe bağlı)"
          error={errors.description}
        >
          <textarea
            className="kv-input"
            id="description"
            maxLength={2000}
            value={draft.description}
            aria-invalid={Boolean(errors.description)}
            aria-describedby={
              errors.description ? "description-error" : undefined
            }
            onChange={(e) => update({ description: e.target.value })}
          />
        </Field>
        {draft.kind === "poll" && (
          <fieldset id="options" tabIndex={-1}>
            <legend>Seçenekler · 2–6 seçenek</legend>
            <div className="screen-stack">
              {draft.options.map((option, i) => (
                <Field
                  key={i}
                  id={`option-${i}`}
                  label={`${i + 1}. seçenek`}
                  error={errors[`option-${i}`]}
                >
                  <div className="option-editor">
                    <input
                      className="kv-input"
                      id={`option-${i}`}
                      required
                      maxLength={120}
                      value={option}
                      aria-invalid={Boolean(errors[`option-${i}`])}
                      aria-describedby={
                        errors[`option-${i}`] ? `option-${i}-error` : undefined
                      }
                      onChange={(e) =>
                        update({
                          options: draft.options.map((v, index) =>
                            index === i ? e.target.value : v,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="kv-button kv-button--ghost"
                      aria-label={`${i + 1}. seçeneği kaldır`}
                      disabled={draft.options.length <= 2}
                      onClick={() => {
                        update({
                          options: draft.options.filter(
                            (_, index) => index !== i,
                          ),
                        });
                        setTimeout(
                          () =>
                            document
                              .getElementById(`option-${Math.max(0, i - 1)}`)
                              ?.focus(),
                          0,
                        );
                      }}
                    >
                      ×
                    </button>
                  </div>
                </Field>
              ))}
              {errors.options && (
                <p className="kv-field-error" role="alert">
                  {errors.options}
                </p>
              )}
              <button
                type="button"
                className="kv-button kv-button--secondary"
                disabled={draft.options.length >= 6}
                onClick={() => {
                  update({ options: [...draft.options, ""] });
                  setTimeout(
                    () =>
                      document
                        .getElementById(`option-${draft.options.length}`)
                        ?.focus(),
                    0,
                  );
                }}
              >
                + Seçenek ekle
              </button>
            </div>
          </fieldset>
        )}
        <Field id="category" label="Kategori" error={errors.category}>
          <select
            id="category"
            className="kv-input"
            value={demo ? draft.category : draft.categoryId ?? ""}
            onChange={(e) => demo ? update({ category: e.target.value }) : update({ categoryId: e.target.value, category: remoteCategories.find(c => c.id === e.target.value)?.name ?? "" })}
          >
            {demo ? categories.map(c => <option key={c}>{c}</option>) : <><option value="">Kategori seç</option>{remoteCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</>}
          </select>
        </Field>
        {categoryError && <div><ErrorMessage message={categoryError} /><button type="button" className="kv-button" onClick={() => retryCategories(n => n + 1)}>Kategorileri tekrar yükle</button></div>}
        {draft.kind === "poll" && (
          <>
            <Field id="hours" label="Anket süresi">
              <select
                id="hours"
                className="kv-input"
                value={draft.hours}
                onChange={(e) => update({ hours: Number(e.target.value) })}
              >
                {[
                  [1, "1 saat"],
                  [24, "1 gün"],
                  [72, "3 gün"],
                  [168, "7 gün"],
                  [720, "30 gün"],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="visibility" label="Sonuç görünürlüğü">
              <select
                id="visibility"
                className="kv-input"
                value={draft.visibility}
                onChange={(e) =>
                  update({
                    visibility: e.target.value as "always" | "after_vote",
                  })
                }
              >
                <option value="after_vote">Oy verdikten sonra</option>
                <option value="always">Herkese açık</option>
              </select>
            </Field>
          </>
        )}
        <label className="kv-checkbox">
          <input
            type="checkbox"
            checked={draft.commentsEnabled}
            onChange={(e) => update({ commentsEnabled: e.target.checked })}
          />
          Yorumlara izin ver
        </label>
        <p className="kv-help">
          Fotoğraf zorunlu değil. Güvenli görsel yükleme medya modülü hazır
          olduğunda eklenecek.
        </p>
        {demo && <div className="cost-summary">
          <span>
            Yayın maliyeti <strong>10 puan</strong>
          </span>
          <span>
            {user
              ? `Bakiyen: ${user.balance} puan`
              : "İlk başarılı demo girişinde: 20 puan"}
          </span>
        </div>}
        {user && user.balance !== null && user.balance < 10 && (
          <p className="error-message" role="status">
            Bakiyen yetersiz. Taslağın korunuyor; okumaya ve oy vermeye devam
            edebilirsin.
          </p>
        )}
        <ErrorMessage message={error} />
        <button
          ref={previewButton}
          className="kv-button"
          disabled={busy || Boolean(user && user.balance !== null && user.balance < 10) || (!demo && !remoteCategories.length)}
        >
          {busy ? "Yayımlanıyor…" : "Yayın önizlemesi"}
        </button>
      </form>
      <dialog
        ref={dialog}
        className="kv-dialog"
        aria-labelledby="publish-title"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
        onClose={() => previewButton.current?.focus()}
      >
        <div className="screen-stack">
          <h2 id="publish-title">Yayımlamaya hazır mısın?</h2>
          <p>{draft.title}</p>
          {demo && <p>
            Bu demo yayın <strong>10 puan</strong> kullanır. İşlemden sonra{" "}
            <strong>{(user?.balance || 0) - 10} puanın</strong> kalır.
          </p>}
          <button
            className="kv-button"
            onClick={publish}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? "Yayımlanıyor…" : (demo ? "10 puan ile yayımla" : "Yayımla")}
          </button>
          <button
            autoFocus
            className="kv-button kv-button--secondary"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            Düzenlemeye dön
          </button>
        </div>
      </dialog>
    </section>
  );
}
