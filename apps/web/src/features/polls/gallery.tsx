"use client";
import { useState } from "react";
import type { Poll } from "../../lib/model";
export function PollGallery({ poll }: { poll: Poll }) {
  const [selected, setSelected] = useState(0);
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const items = poll.gallery || [];
  const current = items[selected];
  if (!items.length && !poll.price && !poll.details?.length) return null;
  return (
    <section className="kv-card screen-stack" aria-labelledby="gallery-title">
      <div>
        <span className="eyebrow">DAHA YAKINDAN BAK</span>
        <h2 id="gallery-title">Galeri ve bilgiler</h2>
      </div>
      {current && (
        <>
          <figure className="gallery-stage">
            {current.status === "ready" && !broken[current.id] ? (
              <img
                src={current.src}
                alt={current.alt}
                width={800}
                height={530}
                onError={() =>
                  setBroken((old) => ({ ...old, [current.id]: true }))
                }
              />
            ) : (
              <div className="gallery-unavailable">
                <span aria-hidden="true">◇</span>
                <p>
                  {current.status === "pending"
                    ? "Görsel inceleniyor."
                    : current.status === "removed"
                      ? "Bu görsel kaldırıldı."
                      : "Görsel yüklenemedi."}
                </p>
                {current.status === "ready" && (
                  <button
                    className="kv-button kv-button--secondary"
                    onClick={() =>
                      setBroken((old) => ({ ...old, [current.id]: false }))
                    }
                  >
                    Görseli tekrar yükle
                  </button>
                )}
              </div>
            )}
            <figcaption aria-live="polite">
              {selected + 1} / {items.length} · {current.alt}
            </figcaption>
          </figure>
          <div
            className="gallery-controls"
            role="group"
            aria-label="Galeri görselleri"
          >
            <button
              className="reaction-button"
              aria-label="Önceki görsel"
              disabled={selected === 0}
              onClick={() => setSelected((n) => n - 1)}
            >
              ←
            </button>
            {items.map((item, i) => (
              <button
                className="gallery-thumb"
                key={item.id}
                aria-label={`${i + 1}. görsel: ${item.alt}`}
                aria-pressed={selected === i}
                onClick={() => setSelected(i)}
              >
                {item.status === "ready" ? (
                  <img src={item.src} alt="" width={80} height={56} />
                ) : (
                  <span>
                    {item.status === "pending" ? "İncelemede" : "Kaldırıldı"}
                  </span>
                )}
              </button>
            ))}
            <button
              className="reaction-button"
              aria-label="Sonraki görsel"
              disabled={selected === items.length - 1}
              onClick={() => setSelected((n) => n + 1)}
            >
              →
            </button>
          </div>
        </>
      )}
      {poll.price && (
        <div className="price-info">
          <span className="kv-help">Paylaşılan örnek bütçe</span>
          <strong>
            {new Intl.NumberFormat("tr-TR", {
              style: "currency",
              currency: poll.price.currency,
            }).format(Number(poll.price.amount))}
          </strong>
          <p className="kv-muted">{poll.price.note}</p>
        </div>
      )}
      {Boolean(poll.details?.length) && (
        <dl className="poll-details">
          {poll.details!.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
