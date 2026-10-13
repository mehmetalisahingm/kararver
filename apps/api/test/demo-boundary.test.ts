/** #187 demo sınırı: staging/production ortamında demo işareti varsa API açılmaz; local/test etkilenmez. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { PEPPER, WEB_ORIGIN } from "./support/harness.ts";

describe("demo sınırı: API yapılandırması", () => {
  const deployed = {
    APP_ENV: "staging",
    WEB_URL: WEB_ORIGIN,
    API_URL: "http://localhost:4000",
    SESSION_COOKIE_SECURE: "true",
    AUTH_TOKEN_PEPPER: PEPPER,
    MAIL_FROM: "KararVer <no-reply@kararver.test>",
    MAIL_TRANSPORT: "smtp",
    SMTP_URL: "smtp://u:p@smtp.test:587",
    MEDIA_PUBLIC_BASE_URL: "http://cdn.test/media",
    S3_ENDPOINT: "http://s3.test",
    S3_ACCESS_KEY_ID: "k",
    S3_SECRET_ACCESS_KEY: "s",
    S3_BUCKET_PRIVATE: "priv",
    S3_BUCKET_PUBLIC: "pub",
  };

  test("staging ve production'da NEXT_PUBLIC_KV_DATA_MODE=demo ile açılmaz", () => {
    for (const APP_ENV of ["staging", "production"]) {
      assert.throws(
        () => loadConfig({ ...deployed, APP_ENV, NEXT_PUBLIC_KV_DATA_MODE: "demo" }),
        /NEXT_PUBLIC_KV_DATA_MODE=demo staging\/production'da kullanılamaz/,
        APP_ENV,
      );
      assert.equal(loadConfig({ ...deployed, APP_ENV, NEXT_PUBLIC_KV_DATA_MODE: "api" }).appEnv, APP_ENV);
      assert.equal(loadConfig({ ...deployed, APP_ENV }).appEnv, APP_ENV);
    }
  });

  test("local ve test ortamında demo işareti API'yi durdurmaz", () => {
    const local = { ...deployed, SESSION_COOKIE_SECURE: "false", NEXT_PUBLIC_KV_DATA_MODE: "demo" };
    assert.equal(loadConfig({ ...local, APP_ENV: "local" }).appEnv, "local");
    assert.equal(loadConfig({ ...local, APP_ENV: "test" }).appEnv, "test");
  });
});
