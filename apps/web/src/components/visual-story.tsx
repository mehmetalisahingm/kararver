import { useId } from "react";

// Product artwork is illustrative. It never represents fabricated votes, users or trends.
export type ArtTopic = "technology" | "university" | "travel" | "gaming" | "sports" | "social" | "food" | "conversation";

export function visualTopic(value: string): ArtTopic {
  const text = value.toLocaleLowerCase("tr-TR").replaceAll("â", "a").replaceAll("î", "i");
  if (/teknoloji|yapay zek|bilim|robot|yazılım|telefon|internet|dijital|ai\b/.test(text)) return "technology";
  if (/üniversite|eğitim|öğren|okul|ders|sınav|kariyer|kitap/.test(text)) return "university";
  if (/seyahat|tatil|gezi|rota|doğa|deniz|kamp|şehir/.test(text)) return "travel";
  if (/eğlence|oyun|gaming|konsol|film|müzik|sinema/.test(text)) return "gaming";
  if (/spor|futbol|basketbol|fitness|koşu|maç/.test(text)) return "sports";
  if (/ilişki|aşk|arkadaş|aile|sosyal|hayat|yaşam/.test(text)) return "social";
  if (/yemek|kahve|mutfak|pizza|burger|yiyecek/.test(text)) return "food";
  return "conversation";
}

function Motif({ topic }: { topic: ArtTopic }) {
  switch (topic) {
    case "technology":
      return <g className="kv-art-float">
        <rect x="156" y="64" width="150" height="146" rx="41" fill="#d9eaff" stroke="#fff" strokeWidth="6"/>
        <path d="M213 64v-24m-14 2 14-12 13 12" fill="none" stroke="#b2a5ff" strokeWidth="8" strokeLinecap="round"/>
        <rect x="175" y="107" width="114" height="70" rx="25" fill="#171a45"/>
        <ellipse cx="203" cy="141" rx="15" ry="11" fill="#42dbff"/>
        <ellipse cx="260" cy="141" rx="15" ry="11" fill="#42dbff"/>
        <path d="M212 167q20 15 39 0" fill="none" stroke="#c4a0ff" strokeWidth="5" strokeLinecap="round"/>
        <rect x="138" y="115" width="20" height="48" rx="10" fill="#7b59ef"/>
        <rect x="303" y="115" width="20" height="48" rx="10" fill="#7b59ef"/>
        <path d="M188 207l-11 28m92-28 12 28" stroke="#d9eaff" strokeWidth="10" strokeLinecap="round"/>
      </g>;
    case "university":
      return <g className="kv-art-float">
        <rect x="125" y="178" width="218" height="43" rx="11" fill="#ef8f62" stroke="#ffdfbc" strokeWidth="5"/>
        <rect x="149" y="134" width="177" height="43" rx="9" fill="#ffffff" stroke="#a9a8ff" strokeWidth="5"/>
        <rect x="134" y="92" width="201" height="42" rx="11" fill="#8dcaff" stroke="#dbf4ff" strokeWidth="5"/>
        <path d="m109 77 124-59 124 59-124 58z" fill="#181a4b" stroke="#bfaeff" strokeWidth="8"/>
        <path d="M336 83v70" stroke="#ffd178" strokeWidth="8" strokeLinecap="round"/>
        <path d="m330 152 6 12 6-12" fill="#ffd178"/>
        <path d="M184 109v23m67-23v23" stroke="#6250c9" strokeWidth="6" strokeLinecap="round"/>
      </g>;
    case "travel":
      return <g className="kv-art-float">
        <circle cx="321" cy="66" r="39" fill="#ffd47c"/>
        <path d="M89 208 196 62l91 146z" fill="#719eff" stroke="#ddf2ff" strokeWidth="6"/>
        <path d="m155 121 41-59 40 62-41-16z" fill="#fff"/>
        <path d="M220 209 323 101l86 108z" fill="#63d2d1" stroke="#c2fffb" strokeWidth="6"/>
        <path d="m294 132 29-31 24 32-25-9z" fill="#e7fff5"/>
        <path d="M96 211q146-57 299 6" stroke="#e6bbff" strokeWidth="14" opacity=".7" fill="none" strokeLinecap="round"/>
        <path d="m315 39 18 9 40-14-37 23-8 24-9-24-22-6z" fill="#fff"/>
      </g>;
    case "gaming":
      return <g className="kv-art-float">
        <path d="M149 103q20-19 85-19t85 19q34 14 51 86 7 39-22 38-19 0-42-31H164q-23 31-43 31-31 0-23-38 17-72 51-86z" fill="#d8d1ff" stroke="#fff" strokeWidth="7"/>
        <rect x="144" y="133" width="61" height="17" rx="7" fill="#383267"/>
        <rect x="166" y="111" width="17" height="61" rx="7" fill="#383267"/>
        <circle cx="289" cy="140" r="11" fill="#fb7597"/>
        <circle cx="320" cy="163" r="11" fill="#3ad9ff"/>
        <circle cx="320" cy="118" r="11" fill="#ffd77c"/>
        <circle cx="350" cy="141" r="11" fill="#aa86ff"/>
        <path d="M218 186h30" stroke="#9b83ed" strokeWidth="8" strokeLinecap="round"/>
      </g>;
    case "sports":
      return <g className="kv-art-float">
        <circle cx="232" cy="130" r="103" fill="#fff" stroke="#e3efff" strokeWidth="7"/>
        <path d="m232 80 43 30-16 50h-54l-16-50z" fill="#23273e"/>
        <path d="m232 80-9-49m52 79 49-26m-65 76 27 43m-81-43-29 42m13-92-52-22m118 91 44 18m-123 0-39 20" stroke="#23273e" strokeWidth="10" strokeLinecap="round"/>
        <circle cx="232" cy="130" r="104" fill="none" stroke="#9a86ff" strokeWidth="6"/>
      </g>;
    case "social":
      return <g className="kv-art-float">
        <path d="M234 218 110 112C57 63 131-2 194 55l40 36 40-36c64-58 138 9 84 57z" fill="#ff6eaf" stroke="#ffd7e6" strokeWidth="8"/>
        <path d="M131 101q37-34 63 7" fill="none" stroke="#fff" strokeWidth="12" strokeLinecap="round" opacity=".67"/>
        <circle cx="344" cy="43" r="19" fill="#ffbb78"/>
        <path d="m101 168-18-18m276 21 18-18" stroke="#fff" strokeWidth="8" strokeLinecap="round"/>
      </g>;
    case "food":
      return <g className="kv-art-float">
        <path d="M155 87h154v111q-3 25-32 25h-91q-31 0-31-25z" fill="#fff3e4" stroke="#fff" strokeWidth="7"/>
        <ellipse cx="232" cy="89" rx="78" ry="17" fill="#6e3c3d" stroke="#fbd5ab" strokeWidth="9"/>
        <path d="M309 117h33q46 5 26 44-14 26-59 25" fill="none" stroke="#fff3e4" strokeWidth="20"/>
        <path d="M187 62q-16-19 1-42m46 42q-16-19 1-42m43 42q-16-19 1-42" fill="none" stroke="#ffd8ad" strokeWidth="8" strokeLinecap="round"/>
        <path d="M148 238h177" stroke="#a992ff" strokeWidth="13" strokeLinecap="round"/>
      </g>;
    default:
      return <g className="kv-art-float">
        <rect x="94" y="51" width="221" height="126" rx="37" fill="#eee7ff" stroke="#fff" strokeWidth="6"/>
        <path d="m139 165-24 46 77-39" fill="#eee7ff" stroke="#fff" strokeWidth="5"/>
        <rect x="165" y="91" width="84" height="11" rx="6" fill="#9272ff"/>
        <rect x="165" y="120" width="114" height="11" rx="6" fill="#9272ff" opacity=".7"/>
        <rect x="233" y="154" width="135" height="74" rx="29" fill="#ff90bf" stroke="#ffd9ec" strokeWidth="6"/>
        <path d="m314 222 32 31-1-34" fill="#ff90bf"/>
        <circle cx="265" cy="189" r="8" fill="#fff"/><circle cx="296" cy="189" r="8" fill="#fff"/><circle cx="327" cy="189" r="8" fill="#fff"/>
      </g>;
  }
}

export function IllustratedScene({ topic, className = "" }: { topic: ArtTopic; className?: string }) {
  const unique = useId().replaceAll(":", "");
  const base = "kv-base-" + unique, shine = "kv-shine-" + unique, haze = "kv-haze-" + unique;
  return <svg className={className} viewBox="0 0 460 260" xmlns="http://www.w3.org/2000/svg" role="presentation" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={base} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#0c1745"/><stop offset=".51" stopColor="#352082"/><stop offset="1" stopColor="#0c5d80"/></linearGradient>
      <radialGradient id={shine}><stop stopColor="#dd7aff" stopOpacity=".67"/><stop offset="1" stopColor="#9b71ff" stopOpacity="0"/></radialGradient>
      <radialGradient id={haze}><stop stopColor="#18d4ff" stopOpacity=".6"/><stop offset="1" stopColor="#18d4ff" stopOpacity="0"/></radialGradient>
    </defs>
    <rect width="460" height="260" rx="18" fill={"url(#"+base+")"}/>
    <circle cx="112" cy="48" r="155" fill={"url(#"+shine+")"}/>
    <circle cx="385" cy="209" r="153" fill={"url(#"+haze+")"}/>
    <path d="M-20 235q139-65 270-16t252-49" stroke="#a88fff" strokeOpacity=".35" strokeWidth="3" fill="none"/>
    <g fill="#fff" opacity=".75"><circle cx="57" cy="70" r="3"/><circle cx="374" cy="39" r="2"/><circle cx="420" cy="112" r="3"/><circle cx="104" cy="199" r="2"/><circle cx="338" cy="232" r="2"/></g>
    <Motif topic={topic}/>
  </svg>;
}

export function HeroScene({ className = "" }: { className?: string }) {
  const unique = useId().replaceAll(":", "");
  const bg = "kv-hero-gradient-" + unique;
  return <svg className={className} viewBox="0 0 570 390" role="presentation" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#b2a0ff"/><stop offset=".6" stopColor="#7442fd"/><stop offset="1" stopColor="#461ca8"/></linearGradient>
      <filter id={"kvShadow"+unique} x="-30%" y="-30%" width="170%" height="170%"><feDropShadow dx="0" dy="14" stdDeviation="18" floodColor="#040525" floodOpacity=".6"/></filter>
    </defs>
    <circle cx="299" cy="210" r="164" fill="#8a4dff" opacity=".22"/>
    <circle cx="300" cy="202" r="125" fill="none" stroke="#e7c4ff" strokeOpacity=".3" strokeWidth="2"/>
    <ellipse cx="294" cy="334" rx="217" ry="28" fill="#080923" opacity=".5"/>
    <g filter={"url(#kvShadow"+unique+")"} className="kv-art-float">
      <rect x="168" y="164" width="248" height="156" rx="32" fill={"url(#"+bg+")"} stroke="#cdb8ff" strokeWidth="7"/>
      <path d="M168 187q123 27 248 0v32q-120 32-248 0z" fill="#5933c3"/>
      <rect x="219" y="218" width="147" height="67" rx="23" fill="#41239c" opacity=".6"/>
      <path d="m254 247 23 22 49-49" fill="none" stroke="#f6f3ff" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round"/>
      <rect x="155" y="140" width="274" height="56" rx="20" fill="#a685ff" stroke="#e1d5ff" strokeWidth="6"/>
      <rect x="251" y="140" width="87" height="11" rx="5" fill="#42288c"/>
    </g>
    <g className="kv-art-float kv-art-float--alt" transform="rotate(-15 240 105)">
      <rect x="210" y="51" width="79" height="112" rx="14" fill="#f6eeff" stroke="#ccb7ff" strokeWidth="5"/>
      <circle cx="249" cy="89" r="16" fill="#8655f7"/>
      <path d="m241 89 6 7 11-14" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M229 122h40" stroke="#b4a0d9" strokeWidth="7" strokeLinecap="round"/>
    </g>
    <g filter={"url(#kvShadow"+unique+")"} transform="rotate(8 111 117)" className="kv-art-float--alt">
      <rect x="26" y="58" width="150" height="115" rx="25" fill="#fbf4ff" stroke="#bda5ff" strokeWidth="5"/>
      <circle cx="59" cy="95" r="14" fill="#8255fc"/>
      <path d="m52 94 6 6 10-13" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round"/>
      <rect x="84" y="88" width="60" height="12" rx="6" fill="#5b479e"/>
      <circle cx="59" cy="137" r="14" fill="#eadbff" stroke="#a18acb" strokeWidth="3"/>
      <rect x="84" y="130" width="60" height="12" rx="6" fill="#9b8cac"/>
    </g>
    <g className="kv-art-float" transform="rotate(11 453 91)">
      <rect x="402" y="39" width="136" height="99" rx="20" fill="#26205e" stroke="#8e78ff" strokeWidth="5"/>
      <rect x="422" y="90" width="17" height="27" rx="5" fill="#ff90c0"/>
      <rect x="449" y="72" width="17" height="45" rx="5" fill="#86cbff"/>
      <rect x="476" y="55" width="17" height="62" rx="5" fill="#bfa5ff"/>
      <path d="m413 126 26-10" stroke="#d8ccff" strokeWidth="3"/>
    </g>
    <g fill="#ffcb72" className="kv-art-spark"><path d="m459 204 10 22 23 10-23 9-10 23-10-23-23-9 23-10z"/><circle cx="127" cy="226" r="8"/><circle cx="491" cy="323" r="5"/></g>
    <path d="m92 277 9 10 18-21" fill="none" stroke="#67e3ff" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="m492 168 11 10 20-24" fill="none" stroke="#ff95c5" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
}
