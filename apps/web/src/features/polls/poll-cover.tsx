"use client";
import {useState} from "react";
import { IllustratedScene } from "../../components/visual-story";
import type { ArtTopic } from "../../components/visual-topic";
import styles from "./polls.module.css";

export function PollCover({src,alt,fallbackTopic}:{src:string;alt:string;fallbackTopic?:ArtTopic}) {
  const [state,setState]=useState<"loading"|"ready"|"error">("loading");
  const [attempt,retry]=useState(0);
  return <div className={styles.cover}>
    {state==="error" ? <div className={styles.coverError}>
      {fallbackTopic && <div className="kv-poll-visual" data-illustration="true"><IllustratedScene topic={fallbackTopic} /></div>}
      <p role="status">Anket görseli yüklenemedi. Anketi yine de inceleyebilirsin.</p>
      <button type="button" className="kv-button kv-button--secondary" onClick={()=>{setState("loading");retry(n=>n+1);}}>Kapak görselini tekrar yükle</button>
    </div> : <>
      {state==="loading" && <p role="status">Anket görseli yükleniyor…</p>}
      <img key={attempt} src={src} alt={alt} width={800} height={500} loading="lazy" onLoad={()=>setState("ready")} onError={()=>setState("error")}/>
    </>}
  </div>;
}
