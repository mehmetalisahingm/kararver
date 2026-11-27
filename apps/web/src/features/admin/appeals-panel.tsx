"use client";
import { useCallback } from "react";
import { useProduct } from "../../components/product-provider";
import type { AdminClient } from "./admin-client";
import { isAdminRole, useAdminRoles, useRemoteList, ListState, formatDate } from "./admin-ui";
import styles from "./admin-shell.module.css";

const urgency = { OPEN: "Bekliyor", DUE_SOON: "Süre yaklaşıyor", OVERDUE: "Hedef aşıldı" } as const;

export function AppealsPanel({admin}: {admin:AdminClient}) {
  const {user}=useProduct();
  const roles=useAdminRoles();
  if(!user || !isAdminRole(roles)) return <p role="alert">Bu bölüm yalnız yöneticilere açıktır.</p>;
  return <Queue key={user.id} admin={admin}/>;
}

function Queue({admin}: {admin:AdminClient}) {
  const load=useCallback((cursor:string|undefined, signal:AbortSignal)=>admin.appealQueue(cursor,signal),[admin]);
  const remote=useRemoteList(load);
  return <section className="kv-card screen-stack" aria-label="Bekleyen itirazlar">
    <h2>İtiraz kuyruğu</h2>
    <p>14 günlük süre bir operasyon hedefidir; hiçbir otomatik karar uygulanmaz. Bu ekran yalnız dosya metaverilerini gösterir. Başvuru gerekçesi ve içerik kanıtı yetkili inceleme akışından doğrulanmadan karar verilmemelidir.</p>
    <button className="kv-button kv-button--secondary" onClick={remote.reload} disabled={remote.loading}>Kuyruğu yenile</button>
    {!remote.loading && !remote.error && remote.items.length>0 && <div className={styles.tableWrap}><table className={styles.table}>
      <thead><tr><th scope="col">Dosya kimliği</th><th scope="col">Anket kimliği</th><th scope="col">Başvuru</th><th scope="col">Hedef</th><th scope="col">Durum</th></tr></thead>
      <tbody>{remote.items.map(row=><tr key={row.rejectionActionId}><td style={{overflowWrap:"anywhere"}}>{row.rejectionActionId}</td><td style={{overflowWrap:"anywhere"}}>{row.pollId}</td><td>{formatDate(row.filedAt)}</td><td>{formatDate(row.resolutionTargetAt)}</td><td>{urgency[row.urgency]}</td></tr>)}</tbody>
    </table></div>}
    <ListState remote={remote} empty="Bekleyen itiraz bulunmuyor."/>
  </section>;
}
