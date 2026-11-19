import { useId } from "react";

// Product artwork is illustrative. It never represents fabricated votes, users or trends.
import type { ArtTopic } from "./visual-topic";
export { visualTopic } from "./visual-topic";

const topicImages: Partial<Record<ArtTopic, string>> = {
  technology: "/art/topics/late-night-desk-v2.webp",
  gaming: "/art/topics/late-night-desk-v2.webp",
  university: "/art/topics/campus-life.webp",
  travel: "/art/topics/alpine-escape.webp",
};

function Motif({ topic }: { topic: ArtTopic }) {
  switch (topic) {
    case "technology":
      return <g className="kv-art-float">
        <rect x="156" y="64" width="150" height="146" rx="41" fill="#d9eaff" stroke="#fff" strokeWidth="6"/>
        <path d="M213 64v-24m-14 2 14-12 13 12" fill="none" stroke="#b2a5ff" strokeWidth="8" strokeLinecap="round"/>
        <rect x="175" y="107" width="114" height="70" rx="25" fill="#092747"/>
        <ellipse cx="203" cy="141" rx="15" ry="11" fill="#42dbff"/>
        <ellipse cx="260" cy="141" rx="15" ry="11" fill="#42dbff"/>
        <path d="M212 167q20 15 39 0" fill="none" stroke="#c4a0ff" strokeWidth="5" strokeLinecap="round"/>
        <rect x="138" y="115" width="20" height="48" rx="10" fill="#216cc6"/>
        <rect x="303" y="115" width="20" height="48" rx="10" fill="#216cc6"/>
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
        <path d="M184 109v23m67-23v23" stroke="#216cc6" strokeWidth="6" strokeLinecap="round"/>
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
        <circle cx="289" cy="140" r="11" fill="#65b9f4"/>
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
        <path d="M234 218 110 112C57 63 131-2 194 55l40 36 40-36c64-58 138 9 84 57z" fill="#318fda" stroke="#ffd7e6" strokeWidth="8"/>
        <path d="M131 101q37-34 63 7" fill="none" stroke="#fff" strokeWidth="12" strokeLinecap="round" opacity=".67"/>
        <circle cx="344" cy="43" r="19" fill="#8cd6fb"/>
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
        <rect x="165" y="91" width="84" height="11" rx="6" fill="#3283d2"/>
        <rect x="165" y="120" width="114" height="11" rx="6" fill="#3283d2" opacity=".7"/>
        <rect x="233" y="154" width="135" height="74" rx="29" fill="#358cce" stroke="#ffd9ec" strokeWidth="6"/>
        <path d="m314 222 32 31-1-34" fill="#358cce"/>
        <circle cx="265" cy="189" r="8" fill="#fff"/><circle cx="296" cy="189" r="8" fill="#fff"/><circle cx="327" cy="189" r="8" fill="#fff"/>
      </g>;
  }
}

export function IllustratedScene({ topic, className = "" }: { topic: ArtTopic; className?: string }) {
  const unique = useId().replaceAll(":", "");
  const image = topicImages[topic];
  if (image) return <img className={`${className} kv-topic-image`} src={image} alt="" aria-hidden="true" width={900} height={600} loading="lazy" decoding="async" />;
  const base = "kv-base-" + unique, shine = "kv-shine-" + unique, haze = "kv-haze-" + unique;
  return <svg className={className} viewBox="0 0 460 260" xmlns="http://www.w3.org/2000/svg" role="presentation" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={base} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#061b36"/><stop offset=".51" stopColor="#0b3762"/><stop offset="1" stopColor="#0a5378"/></linearGradient>
      <radialGradient id={shine}><stop stopColor="#66baff" stopOpacity=".67"/><stop offset="1" stopColor="#268fe8" stopOpacity="0"/></radialGradient>
      <radialGradient id={haze}><stop stopColor="#18d4ff" stopOpacity=".6"/><stop offset="1" stopColor="#18d4ff" stopOpacity="0"/></radialGradient>
    </defs>
    <rect width="460" height="260" rx="18" fill={"url(#"+base+")"}/>
    <circle cx="112" cy="48" r="155" fill={"url(#"+shine+")"}/>
    <circle cx="385" cy="209" r="153" fill={"url(#"+haze+")"}/>
    <path d="M-20 235q139-65 270-16t252-49" stroke="#72c6ff" strokeOpacity=".35" strokeWidth="3" fill="none"/>
    <g fill="#fff" opacity=".75"><circle cx="57" cy="70" r="3"/><circle cx="374" cy="39" r="2"/><circle cx="420" cy="112" r="3"/><circle cx="104" cy="199" r="2"/><circle cx="338" cy="232" r="2"/></g>
    <Motif topic={topic}/>
  </svg>;
}
