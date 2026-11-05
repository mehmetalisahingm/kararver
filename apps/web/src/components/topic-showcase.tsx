import { useRef } from "react";
import Link from "next/link";
import { IllustratedScene, visualTopic } from "./visual-story";
import type { ArtTopic } from "./visual-topic";

type Topic = { slug: string; name: string };

const suggestions: { topic: ArtTopic; label: string; query: string }[] = [
  { topic: "technology", label: "Teknoloji ve oyun", query: "teknoloji" },
  { topic: "university", label: "Kampüs ve kariyer", query: "üniversite" },
  { topic: "travel", label: "Doğa ve seyahat", query: "seyahat" },
];

export function TopicShowcase({ categories }: { categories: Topic[] }) {
  const rail = useRef<HTMLDivElement>(null);
  function scroll(direction: number) {
    const element = rail.current;
    if (!element) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollBy({ left: direction * element.clientWidth * .8, behavior: reducedMotion ? "instant" : "smooth" });
  }
  return <section className="topic-showcase" aria-labelledby="topic-showcase-title">
    <div className="topic-showcase-heading">
      <div><span className="eyebrow">BİR KONU, YENİ BİR BAKIŞ</span><h2 id="topic-showcase-title">Merakına göre keşfet</h2></div>
      <div className="topic-showcase-controls">
        <button type="button" onClick={() => scroll(-1)} aria-label="Önceki konular" aria-controls="topic-showcase-rail">←</button>
        <button type="button" onClick={() => scroll(1)} aria-label="Sonraki konular" aria-controls="topic-showcase-rail">→</button>
      </div>
    </div>
    <div className="topic-showcase-rail" ref={rail} id="topic-showcase-rail" tabIndex={0} role="region" aria-label="Keşfedilecek konular">
      {suggestions.map(suggestion => {
        const category = categories.find(item => visualTopic(item.name) === suggestion.topic);
        const href = category ? `/kategori/${category.slug}` : `/kesfet?q=${encodeURIComponent(suggestion.query)}`;
        return <Link className="topic-showcase-card" href={href} key={suggestion.topic}>
          <IllustratedScene topic={suggestion.topic} />
          <span>{category?.name ?? suggestion.label}<span aria-hidden="true">↗</span></span>
        </Link>;
      })}
    </div>
  </section>;
}
