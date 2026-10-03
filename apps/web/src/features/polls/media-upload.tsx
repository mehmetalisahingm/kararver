"use client";
import { useEffect, useRef, useState } from "react";
import type { Media, MediaClient, Upload } from "../../lib/media-client";
import { ErrorMessage } from "../../components/fields";

type Item = { key: string; file: File; ticket?: Upload; uploaded?: boolean; media?: Media; busy: boolean; error: string };
export type MediaSelection = { ids: string[]; blocked: boolean };
export function MediaUpload({client,disabled,onChange}:{client:MediaClient;disabled:boolean;onChange:(selection:MediaSelection)=>void}) {
  const [items,setItems]=useState<Item[]>([]);
  const [error,setError]=useState("");
  const controllers=useRef(new Set<AbortController>());
  const active=useRef(true);
  const running=useRef(new Set<string>());
  const lock=useRef(false);
  const busy=items.some(item=>item.busy);
  useEffect(()=>{active.current=true;return()=>{active.current=false;for(const c of controllers.current)c.abort();};},[]);
  useEffect(()=>{
    onChange({ids:items.flatMap(i=>i.media && i.media.status!=="REJECTED" ? [i.media.id] : []),blocked:items.some(i=>i.busy || !i.media || i.media.status==="REJECTED")});
  },[items,onChange]);
  function patch(key:string,change:Partial<Item>) {setItems(old=>old.map(i=>i.key===key?{...i,...change}:i));}
  async function run(item:Item) {
    if(!active.current || running.current.has(item.key))return;
    running.current.add(item.key);
    const controller=new AbortController();controllers.current.add(controller);
    const signal=controller.signal;
    patch(item.key,{busy:true,error:""});
    try {
      let ticket=item.ticket;
      if (!item.uploaded) {
        // Reuse the key to renew an expired URL without creating a second media asset.
        ticket=await client.begin(item.file,item.key,signal);patch(item.key,{ticket});
        await client.put(ticket,item.file,signal);patch(item.key,{uploaded:true});
      }
      const media=item.media ? await client.get(item.media.id,signal) : await client.complete(ticket!.mediaId,signal);
      patch(item.key,{media});
    } catch(e) {
      if(!signal.aborted)patch(item.key,{error:(e as Error).message});
    } finally {if(!signal.aborted)patch(item.key,{busy:false});controllers.current.delete(controller);running.current.delete(item.key);}
  }
  async function choose(files:File[]) {
    if(lock.current || busy || disabled)return;
    if(items.length+files.length>10){setError("En fazla 10 görsel ekleyebilirsin.");return;}
    if(files.some(f=>!["image/jpeg","image/png","image/webp"].includes(f.type) || !f.size || f.size>8*1024*1024)) {
      setError("Her görsel JPEG, PNG veya WebP olmalı; boş olmamalı ve 8 MB sınırını aşmamalı.");return;
    }
    lock.current=true;setError("");
    const added=files.map(file=>({key:crypto.randomUUID(),file,busy:true,error:""}));
    setItems(old=>[...old,...added]);
    try {for(const item of added)await run(item);} finally {lock.current=false;}
  }
  // Bound automatic checks; manual retry remains available after an outage or long review.
  const [checks,setChecks]=useState(0);
  useEffect(()=>{
    const pending=items.filter(i=>i.media?.status==="PENDING" && !i.error);
    if(!pending.length || busy || disabled || checks>=12)return;
    const timer=setTimeout(()=>{setChecks(n=>n+1);void (async()=>{for(const item of pending)await run(item);})();},5000);
    return()=>clearTimeout(timer);
  },[items,busy,disabled,checks]);
  function move(index:number,delta:number) {setItems(old=>{const next=[...old];[next[index],next[index+delta]]=[next[index+delta],next[index]];return next;});}
  return <fieldset disabled={disabled} className="screen-stack" aria-describedby="media-help">
    <legend>Fotoğraflar (isteğe bağlı)</legend>
    <p id="media-help" className="kv-help">En fazla 10 JPEG, PNG veya WebP; dosya başına 8 MB. Yalnız onaylanan görseller herkese görünür. Sayfadan ayrılırsan dosyaları yeniden seçmen gerekir.</p>
    <label>Görsel ekle<input className="kv-input" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy || items.length>=10} onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value="";void choose(files);}} /></label>
    <ErrorMessage message={error}/>
    {items.map((item,index)=><div className="kv-card screen-stack" key={item.key}>
      <strong style={{overflowWrap:"anywhere"}}>{index+1}. {item.file.name}</strong>
      <p role="status">{item.busy?"Görsel yükleniyor / durumu kontrol ediliyor…":item.media?.status==="APPROVED"?"Görsel onaylandı.":item.media?.status==="PENDING"?"Görsel işleniyor. Onaylanınca galeride görünecek.":item.media?.status==="QUARANTINED"?"Görsel incelemede. Henüz herkese görünmüyor.":item.media?.status==="REJECTED"?"Görsel reddedildi. Yayımlamadan önce listeden kaldırmalısın.":"Yükleme tamamlanmadı."}</p>
      <ErrorMessage message={item.error}/>
      <div className="kv-row">
        {(item.error || !item.media || ["PENDING","QUARANTINED"].includes(item.media.status)) && <button type="button" className="kv-button kv-button--secondary" disabled={busy} onClick={()=>void run(item)}>{item.media?"Durumu tekrar kontrol et":"Yüklemeyi tekrar dene"}</button>}
        <button type="button" className="kv-button kv-button--ghost" aria-label={`${index+1}. görseli önceye taşı`} disabled={busy || index===0} onClick={()=>move(index,-1)}>←</button>
        <button type="button" className="kv-button kv-button--ghost" aria-label={`${index+1}. görseli sonraya taşı`} disabled={busy || index===items.length-1} onClick={()=>move(index,1)}>→</button>
        <button type="button" className="kv-button kv-button--ghost" disabled={busy} onClick={()=>setItems(old=>old.filter(i=>i.key!==item.key))}>Listeden kaldır</button>
      </div>
    </div>)}
  </fieldset>;
}
