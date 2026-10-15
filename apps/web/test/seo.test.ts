import { test } from "node:test";
import assert from "node:assert/strict";
import { publicRobots, privateMetadata, privatePaths } from "../src/lib/seo.ts";

test("public content is indexable only in the explicit production environment", () => {
  const previous = process.env.APP_ENV;
  try {
    for (const value of [undefined, "staging", "preview", "local", "prod"]) {
      if (value === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = value;
      assert.deepEqual(publicRobots(), { index: false, follow: false });
    }
    process.env.APP_ENV = "production";
    assert.deepEqual(publicRobots(), { index: true, follow: true });
    assert.deepEqual(privateMetadata.robots, { index: false, follow: false });
  } finally {
    if (previous === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previous;
  }
});

test("crawler exclusions include the real password and private delivery routes", () => {
  for (const path of ["/sifremi-unuttum", "/sifre-yenile", "/veri-indir", "/hesap", "/admin", "/ilgi-alanlari"])
    assert.ok(privatePaths.includes(path), path);
  assert.ok(!privatePaths.includes("/sifre-sifirla"));
});
