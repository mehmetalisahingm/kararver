import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HeroScene, IllustratedScene, visualTopic } from "../src/components/visual-story";

test("visual topic art follows category meaning rather than position in list", () => {
  assert.equal(visualTopic("Yapay Zekâ"), "technology");
  assert.equal(visualTopic("Üniversite"), "university");
  assert.equal(visualTopic("Tatil ve seyahat"), "travel");
  assert.equal(visualTopic("Video oyunları"), "gaming");
  assert.equal(visualTopic("Spor"), "sports");
  assert.equal(visualTopic("İlişkiler"), "social");
  assert.equal(visualTopic("Kahve"), "food");
  assert.equal(visualTopic("Kültür"), "conversation");
});

test("illustrations stay accessible and do not claim fabricated participation", () => {
  const hero = renderToStaticMarkup(createElement(HeroScene));
  const category = renderToStaticMarkup(createElement(IllustratedScene, { topic: "technology" }));
  assert.match(hero, /<svg/);
  assert.match(category, /<svg/);
  assert.match(hero, /aria-hidden="true"/);
  assert.match(category, /aria-hidden="true"/);
  assert.doesNotMatch(hero + category, /aktif kullanıcı|oy verildi|canlı kullanıcı|50.?000/);
});

test("category-specific artwork produces different illustrations", () => {
  const tech = renderToStaticMarkup(createElement(IllustratedScene, { topic: "technology" }));
  const sport = renderToStaticMarkup(createElement(IllustratedScene, { topic: "sports" }));
  assert.notEqual(tech, sport);
});
