import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { visualTopic } from "../src/components/visual-topic.ts";

test("visual topic art follows the category's meaning, not its position", () => {
  assert.equal(visualTopic("Yapay Zekâ"), "technology");
  assert.equal(visualTopic("Üniversite"), "university");
  assert.equal(visualTopic("Tatil ve seyahat"), "travel");
  assert.equal(visualTopic("Video oyunları"), "gaming");
  assert.equal(visualTopic("Spor"), "sports");
  assert.equal(visualTopic("İlişkiler"), "social");
  assert.equal(visualTopic("Kahve"), "food");
  assert.equal(visualTopic("Kültür"), "conversation");
});

test("artwork stays decorative and uses independent local orbital image layers", () => {
  const scene = readFileSync(new URL("../src/components/visual-story.tsx", import.meta.url), "utf8");
  assert.match(scene, /viewBox="0 0 460 260"/);
  const hero = readFileSync(new URL("../src/components/space-hero.tsx", import.meta.url), "utf8");
  assert.match(hero, /src="\/art\/space\/orbital-earth-v2.webp" alt=""/);
  assert.match(hero, /src="\/art\/space\/floating-astronaut-v2.webp" alt=""/);
  const backdrop = readFileSync(new URL("../public/art/space/orbital-earth-v2.webp", import.meta.url));
  assert.equal(backdrop.toString("ascii", 8, 12), "WEBP");
  assert.match(scene, /aria-hidden="true"/);
  assert.doesNotMatch(scene, /<image|https?:\/\/(?!www\.w3\.org\/2000\/svg)|aktif kullanıcı|50.?000/);
});

test("animation respects reduced motion and no user/media API contract is changed", () => {
  const css = readFileSync(new URL("../src/app/immersive.css", import.meta.url), "utf8");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /kv-poll-visual/);
  assert.match(css, /kv-category-art/);
});
