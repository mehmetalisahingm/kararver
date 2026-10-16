"use client";
// Kullanıcı birleşik geçmişi (#183, KV-33 §13): anket, yorum, medya, rapor, moderasyon ve yaptırım olayları tek zaman çizgisinde.
// Salt okuma, ADMIN+. IP/cihaz bilgisi yoktur. Süzgeçler: tür, topluluk, içerik kimliği, tarih aralığı.
import { useCallback, useEffect, useState } from "react";
import type { AdminClient, Community, UserTimelineSummaryView } from "./admin-client.ts";
import { ListState, formatDate, useRemoteList } from "./admin-ui";
import { contentIdProblem, describeItem, emptyFilter, kindLabels, summaryChips, TIMELINE_KINDS, toQuery, type TimelineFilter, type TimelineKind } from "./timeline-model.ts";

export function UserTimeline({ id, admin }: { id: string; admin: AdminClient }) {
  const [filter, setFilter] = useState<TimelineFilter>(emptyFilter);
  const [applied, setApplied] = useState<TimelineFilter>(emptyFilter);
  const [summary, setSummary] = useState<UserTimelineSummaryView | null>(null);
  const [communities, setCommunities] = useState<Community[]>([]);
  const problem = contentIdProblem(filter.contentId);

  useEffect(() => {
    const controller = new AbortController();
    admin.userTimelineSummary(id, controller.signal).then((value) => { if (!controller.signal.aborted) setSummary(value); }, () => setSummary(null));
    admin.communities(undefined, controller.signal).then((page) => { if (!controller.signal.aborted) setCommunities(page.items); }, () => setCommunities([]));
    return () => controller.abort();
  }, [admin, id]);

  const queryKey = JSON.stringify(toQuery(applied));
  const list = useRemoteList(useCallback((cursor, signal) => admin.userTimeline(id, JSON.parse(queryKey) as Record<string, string>, cursor, signal), [admin, id, queryKey]));

  function toggle(kind: TimelineKind) {
    const next = new Set(filter.kinds);
    if (!next.delete(kind)) next.add(kind);
    setFilter({ ...filter, kinds: next });
  }

  return (
    <section className="kv-stack" aria-label="Birleşik geçmiş">
      <h3>Birleşik geçmiş</h3>
      <p className="kv-muted">Anket, yorum, görsel, rapor, moderasyon kararı ve yaptırımlar tek zaman çizgisinde. IP ve cihaz bilgisi gösterilmez; raporlayan kimliği gizlidir.</p>
      {summary ? (
        <p aria-label="Olay sayıları">
          {summaryChips(summary.counts).map((chip) => <span key={chip.kind} className="kv-badge">{chip.label}: {chip.count}</span>)}
          {summary.firstAt ? <span className="kv-muted"> · {formatDate(summary.firstAt)} – {formatDate(summary.lastAt)}</span> : <span className="kv-muted">Henüz olay yok.</span>}
        </p>
      ) : null}
      <form onSubmit={(event) => { event.preventDefault(); if (!problem) setApplied(filter); }} className="kv-stack">
        <fieldset>
          <legend>Olay türü (hiçbiri seçili değilse hepsi)</legend>
          {TIMELINE_KINDS.map((kind) => (
            <label key={kind} className="kv-check"><input type="checkbox" checked={filter.kinds.has(kind)} onChange={() => toggle(kind)} /> {kindLabels[kind]}</label>
          ))}
        </fieldset>
        {communities.length > 0 ? (
          <label>Topluluk
            <select className="kv-input" value={filter.communityId} onChange={(event) => setFilter({ ...filter, communityId: event.target.value })}>
              <option value="">Tümü</option>
              {communities.map((community) => <option key={community.id} value={community.id}>{community.name}</option>)}
            </select>
          </label>
        ) : null}
        <label>İçerik kimliği (anket, yorum veya görsel)
          <input className="kv-input" value={filter.contentId} onChange={(event) => setFilter({ ...filter, contentId: event.target.value })} placeholder="UUID" aria-invalid={problem !== null} />
        </label>
        {problem ? <p role="alert">{problem}</p> : null}
        <label>Başlangıç<input className="kv-input" type="date" value={filter.from} onChange={(event) => setFilter({ ...filter, from: event.target.value })} /></label>
        <label>Bitiş<input className="kv-input" type="date" value={filter.to} onChange={(event) => setFilter({ ...filter, to: event.target.value })} /></label>
        <div className="kv-row">
          <button className="kv-button" disabled={problem !== null}>Süz</button>
          <button type="button" className="kv-button kv-button--ghost" onClick={() => { setFilter(emptyFilter()); setApplied(emptyFilter()); }}>Süzgeci temizle</button>
        </div>
      </form>
      <ol aria-label="Olaylar">
        {list.items.map((item) => (
          <li key={`${item.kind}:${item.id}`}>
            <strong>{kindLabels[item.kind]}</strong> · {formatDate(item.at)} · {describeItem(item) || "—"}
          </li>
        ))}
      </ol>
      <ListState remote={list} empty="Bu süzgece uyan olay yok." />
    </section>
  );
}
