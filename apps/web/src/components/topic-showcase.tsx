"use client";
import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { visualTopic } from "./visual-topic";
import { useScrollScene } from "./scene-motion";
type Topic = { slug: string; name: string };
const stories = [
  { topic: "travel", label: "Kaçsak mı?", category: "Doğa & seyahat", query: "seyahat", image: "/art/topics/alpine-escape.webp", note: "Bir rota. Bin ihtimal.", number: "01" },
  { topic: "university", label: "Ya sonra?", category: "Kampüs & kariyer", query: "üniversite", image: "/art/topics/campus-life.webp", note: "Sıradaki adım senin.", number: "02" },
  { topic: "social", label: "Sence de?", category: "Gündelik meseleler", query: "günlük yaşam", image: "/art/topics/bosphorus-afternoon-v2.webp", note: "Bazen konu sadece bir çay.", number: "03" },
] as const;
export function TopicShowcase({ categories }: { categories: Topic[] }) {
  const { ref, still } = useScrollScene("reveal");
  const [active, setActive] = useState<number | null>(null);
  return <section ref={ref} className="gravity-topics" id="discovery-stage" data-still={still} aria-labelledby="topic-showcase-title">
    <div className="gravity-section-index"><span>02 — DÜNYAYA DÖNELİM</span><span>FİKRİN NEREDE?</span></div>
    <div className="gravity-topics-heading"><h2 id="topic-showcase-title">Uzay güzel de,<br /><em>hayat burada.</em></h2><p>Büyük kararlar.{" "}<br />Küçük takıntılar.{" "}<br />Hepsine yer var.</p></div>
    <div className="gravity-story-cards" data-active={active === null ? "none" : active} onPointerLeave={() => setActive(null)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setActive(null); }}>
      {stories.map((story, index) => {
        const category = categories.find(item => visualTopic(item.name) === story.topic);
        const href = category ? "/kategori/" + category.slug : "/kesfet?q=" + encodeURIComponent(story.query);
        return <Link key={story.topic} className="gravity-story-card" href={href} onPointerEnter={() => setActive(index)} onFocus={() => setActive(index)} style={{ "--card-turn": [-5, 4, -3][index] + "deg", "--card-rise": [110, -45, 155][index] + "px" } as CSSProperties}>
          <div className="gravity-story-image"><img src={story.image} alt="" width="900" height="675" loading="lazy" /><span>{story.number} / {category?.name ?? story.category}</span><strong>{story.label}</strong><span className="gravity-story-arrow" aria-hidden="true">↗</span></div>
          <div className="gravity-story-caption"><span>{story.note}</span><span aria-hidden="true">↗</span></div>
        </Link>;
      })}
    </div>
    <a className="gravity-next" href="#home-feed"><span>Şimdi söz sende.</span><span aria-hidden="true">↓</span></a>
  </section>;
}
