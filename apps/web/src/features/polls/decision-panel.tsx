"use client";
import { useEffect, useRef, useState } from "react";
import { useProduct } from "../../components/product-provider";
import { ErrorMessage, Loading } from "../../components/fields";
import { UiError, type DecisionState, type Poll } from "../../lib/model";

export function DecisionPanel({ poll }: { poll: Poll }) {
 const { client, user, requireUser, syncUser, notify } = useProduct();
 const [state, setState] = useState<DecisionState | null>(null);
 const [note, setNote] = useState("");
 const [option, setOption] = useState("");
 const [error, setError] = useState("");
 const [attempt, retry] = useState(0);
 const [busy, setBusy] = useState(false);
 const lock = useRef(false);
 useEffect(() => {
  const abort = new AbortController();
  setState(null); setError("");
  client.getDecision?.(poll.id, abort.signal).then(value => {
   if (abort.signal.aborted) return;
   setState(value); setNote(value.decision?.note ?? ""); setOption(value.decision?.chosenOptionId ?? "");
  }).catch((e: Error) => { if (!abort.signal.aborted) setError(e.message); });
  return () => abort.abort();
 }, [client, poll.id, user?.id, attempt]);
 if (!client.getDecision) return null;
 async function act(kind: "follow" | "decision") {
  if (!requireUser(poll.canonicalPath ?? `/karar/${poll.id}`) || lock.current || !state) return;
  lock.current = true; setBusy(true); setError("");
  try {
   if (kind === "follow" && client.setFollow) {
    const following = await client.setFollow(poll.id, !state.following);
    setState({ ...state, following }); notify(following ? "Sonucu takip ediyorsun." : "Takip bırakıldı.");
   } else if (kind === "decision" && client.setDecision) {
    const decision = await client.setDecision(poll.id, { chosenOptionId: option || null, note: note.trim() });
    setState({ ...state, decision }); setNote(decision.note); notify("Kararın paylaşıldı.");
   }
  } catch (e) {
   setError((e as Error).message);
   if (e instanceof UiError && e.code === "UNAUTHENTICATED") { syncUser(); requireUser(poll.canonicalPath ?? `/karar/${poll.id}`); }
  } finally { lock.current = false; setBusy(false); }
 }
 return <section className="kv-card screen-stack" aria-labelledby="decision-title">
  <div className="kv-row kv-between"><h2 id="decision-title">{state?.decision ? "Kararını verdi" : "Karar yolculuğu"}</h2>
   {state && client.setFollow && <button className="kv-button kv-button--ghost" aria-pressed={state.following} disabled={busy} onClick={() => void act("follow")}>
    {state.following ? "Takibi bırak" : "Sonucu takip et"}
   </button>}
  </div>
  {!state && !error && <Loading label="Karar yükleniyor…" />}
  <ErrorMessage message={error} />
  {!state && error && <button className="kv-button" onClick={() => retry(n => n + 1)}>Tekrar dene</button>}
  {state?.decision ? <div className="screen-stack">
   {state.decision.chosenOptionId && <strong>Seçimi: {poll.options.find(o => o.id === state.decision!.chosenOptionId)?.label}</strong>}
   <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{state.decision.note}</p>
   <time className="kv-help" dateTime={state.decision.updatedAt}>{new Date(state.decision.updatedAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</time>
  </div> : state && <p className="kv-muted">Henüz bir karar paylaşılmadı. Takip ederek kapanış ve karar güncellemelerinden haberdar olabilirsin.</p>}
  {state?.isAuthor && client.setDecision && poll.status !== "LOCKED" && <form className="screen-stack" onSubmit={e => { e.preventDefault(); void act("decision"); }}>
   <h3>{state.decision ? "Kararını güncelle" : "Kararımı verdim"}</h3>
   <p className="kv-help">Kararın oylama sonuçlarını veya anketin kapanışını değiştirmez.</p>
   {poll.kind === "poll" && <label>Seçimin<select value={option} disabled={busy} onChange={e => setOption(e.target.value)}>
    <option value="">Seçenek belirtmeden paylaş</option>{poll.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
   </select></label>}
   <label>Kararın ve gerekçen<textarea value={note} required maxLength={1000} disabled={busy} onChange={e => setNote(e.target.value)} rows={4} /></label>
   <span className="kv-help">{note.length}/1000</span>
   <button className="kv-button" disabled={busy || !note.trim()} aria-busy={busy}>{busy ? "Kaydediliyor…" : "Kararımı paylaş"}</button>
  </form>}
 </section>;
}
