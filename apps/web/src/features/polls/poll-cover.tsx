"use client";
import {useState, type ReactNode} from "react";
import styles from "./polls.module.css";

export function PollCover({src,alt,fallback}:{src:string;alt:string;fallback?:ReactNode}) {
  const [state,setState]=useState<"loading"|"ready"|"error">("loading");
  const [attempt,retry]=useState(0);
  return <div className={styles.cover}>
    {state==="error" ? <>
      {fallback && <div className={styles.coverFallback}>{fallback}</div>}
      <div className={fallback ? `${styles.coverError} ${styles.coverErrorWithFallback}` : styles.coverError}>
        <p role="status">Anket görseli yüklenemedi. Anketi yine de inceleyebilirsin.</p>
        <button type="button" className="kv-button kv-button--secondary" onClick={()=>{setState("loading");retry(n=>n+1);}}>Kapak görselini tekrar yükle</button>
      </div>
    </> : <>
      {state==="loading" && <p role="status">Anket görseli yükleniyor…</p>}
      <img key={attempt} src={src} alt={alt} width={800} height={500} loading="lazy" onLoad={()=>setState("ready")} onError={()=>setState("error")}/>
    </>}
  </div>;
}
