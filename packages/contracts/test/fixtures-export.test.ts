import assert from "node:assert/strict";
import { test } from "node:test";
import type { z } from "zod";
import { examples } from "@kararver/contracts/fixtures";
import { examples as baseExamples } from "../fixtures/examples.ts";
import { allErrors, ErrorBody, errorStatuses, getEndpoint } from "../src/index.ts";

function mustParse(schema: z.ZodType, value: unknown, label: string): void {
  const result = schema.safeParse(value);
  if (!result.success) assert.fail(`${label}: ${JSON.stringify(result.error.issues, null, 2)}`);
}

test("fixture export güncel temel örnekleri korur ve KV-06 senaryolarını ekler", () => {
  assert.ok(examples.length > baseExamples.length);
  for (const expected of [
    ["trends.list", "daily-rising"],
    ["votes.put", "unverified"],
    ["media.get", "pending"],
    ["comments.list", "empty"],
    ["notifications.unreadCount", "zero"],
  ] as const) {
    assert.ok(examples.some((x) => x.endpoint === expected[0] && x.name === expected[1]), `${expected.join("/")} eksik`);
  }
});

test("mock senaryo adları endpoint içinde tekildir", () => {
  const seen = new Set<string>();
  for (const example of examples) {
    const key = `${example.endpoint}/${example.name}`;
    assert.ok(!seen.has(key), `${key} tekrar ediyor`);
    seen.add(key);
  }
});

test("genişletilmiş fixture'lar request/response/error sözleşmesine uyar", () => {
  for (const example of examples) {
    const endpoint = getEndpoint(example.endpoint);
    const label = `${example.endpoint}/${example.name}`;
    const { params, query, body } = endpoint.request;
    if (params) mustParse(params, example.request?.params ?? {}, `${label} params`);
    if (query) mustParse(query, example.request?.query ?? {}, `${label} query`);
    if (body) mustParse(body, example.request?.body, `${label} body`);
    if (!body) assert.equal(example.request?.body, undefined, `${label}: gövde beklenmiyor`);

    if (example.status < 300) {
      const schema = endpoint.responses[example.status];
      assert.ok(schema, `${label}: ${example.status} başarı cevabı sözleşmede yok`);
      mustParse(schema, example.body, `${label} response`);
    } else {
      mustParse(ErrorBody, example.body, `${label} error`);
      const code = (example.body as { error: { code: keyof typeof errorStatuses } }).error.code;
      assert.equal(errorStatuses[code], example.status, `${label}: hata status eşleşmiyor`);
      assert.ok(allErrors(endpoint).includes(code), `${label}: ${code} endpoint hata listesinde yok`);
    }
  }
});
