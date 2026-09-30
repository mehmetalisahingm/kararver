import assert from "node:assert/strict";
import { test } from "node:test";
import { getEndpoint } from "../src/index.ts";

const schema = getEndpoint("interests.put").request.body!;
const idA = "018f37a0-8c45-7b2a-8d00-111111111111";
const idB = "018f37a0-8c45-7b2a-8d00-222222222222";

test("KV-15: boş ilgi listesi atlama/temizleme için geçerlidir", () => {
  assert.equal(schema.safeParse({ categoryIds: [] }).success, true);
});

test("KV-15: aynı kategori iki kez seçilemez", () => {
  assert.equal(schema.safeParse({ categoryIds: [idA, idA] }).success, false);
  assert.equal(schema.safeParse({ categoryIds: [idA, idB] }).success, true);
});

test("KV-15: en fazla 20 kategori seçilir", () => {
  const ids = Array.from({ length: 21 }, (_, i) => `018f37a0-8c45-7b2a-8d00-${String(i + 1).padStart(12, "0")}`);
  assert.equal(schema.safeParse({ categoryIds: ids }).success, false);
});
