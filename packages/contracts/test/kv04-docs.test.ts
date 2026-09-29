// docs/KV-04_ROLES_EVENTS.md ↔ kod senkronu: katalogdaki her işlem, olay ve ayar belgede geçer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { actions, defaultSettings, eventCatalog, settingKeys } from "../src/index.ts";

const doc = readFileSync(path.join(import.meta.dirname, "../../../docs/KV-04_ROLES_EVENTS.md"), "utf8");
const section = (from: string, to: string) => doc.slice(doc.indexOf(from), doc.indexOf(to));

test("her işlem belgedeki işlem kataloğunda", () => {
  const s = section("### 1.3 İşlem kataloğu", "## 2. Olaylar");
  for (const id of Object.keys(actions)) assert.ok(s.includes(`\`${id}\``), id);
});

test("her olay tipi belgedeki katalog tablosunda", () => {
  const s = section("### 2.2 Katalog", "## 3. Ayarlar");
  for (const t of Object.keys(eventCatalog)) assert.ok(s.includes(`| \`${t}\` |`), t);
});

test("her ayar belgedeki tabloda; varsayılanı eksik olanlar 'yok' ve açık konularda", () => {
  const s = section("## 3. Ayarlar", "## 4. Kararlar");
  for (const k of settingKeys) assert.ok(s.includes(`| \`${k}\` |`), k);
  const open = doc.slice(doc.indexOf("## 5. Açık konular"));
  for (const k of defaultSettings().missing) {
    assert.match(s, new RegExp(`\\| \`${k.replace(".", "\\.")}\` \\| (boolean|integer) \\| [^|]+ \\| \\*\\*yok\\*\\*`), k);
    assert.ok(open.includes(`\`${k}\``), `${k} açık konularda yok`);
  }
});
