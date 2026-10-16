// #51 SMTP hazırlık kontrolü: DNS değerlendirmeleri ve yerel sahte SMTP sunucusuyla STARTTLS yokluğu.
import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { checkMailReadiness, checkSmtp, evaluateDkim, evaluateDmarc, evaluateFrom, evaluateSpf } from "./mail-readiness.mjs";

test("SPF: tek kayıt ve -all/~all PASS; +all ve çift kayıt FAIL; ?all WARN", () => {
  assert.equal(evaluateSpf(["v=spf1 include:_spf.saglayici.com -all"]).result, "PASS");
  assert.equal(evaluateSpf(["v=spf1 include:x ~all", "google-site-verification=abc"]).result, "PASS");
  assert.equal(evaluateSpf(["v=spf1 +all"]).result, "FAIL");
  assert.equal(evaluateSpf(["v=spf1 all"]).result, "FAIL");
  assert.equal(evaluateSpf(["v=spf1 a -all", "v=spf1 mx -all"]).result, "FAIL");
  assert.equal(evaluateSpf(["v=spf1 include:x ?all"]).result, "WARN");
  assert.equal(evaluateSpf(["v=spf1 redirect=_spf.saglayici.com"]).result, "PASS");
  assert.equal(evaluateSpf(["v=spf1 include:x"]).result, "WARN");
  assert.equal(evaluateSpf([]).result, "FAIL");
});

test("DMARC: none WARN, quarantine/reject PASS, eksik ya da politikasız FAIL", () => {
  assert.equal(evaluateDmarc(["v=DMARC1; p=reject; rua=mailto:d@x"]).result, "PASS");
  assert.equal(evaluateDmarc(["v=DMARC1;p=quarantine"]).result, "PASS");
  assert.equal(evaluateDmarc(["v=DMARC1; p=none"]).result, "WARN");
  assert.equal(evaluateDmarc(["v=DMARC1; rua=mailto:d@x"]).result, "FAIL");
  assert.equal(evaluateDmarc([]).result, "FAIL");
});

test("DKIM: anahtar varsa PASS; boş p= (iptal) ve kayıt yokluğu FAIL", () => {
  assert.equal(evaluateDkim(["v=DKIM1; k=rsa; p=MIIBIjANBgkqh"]).result, "PASS");
  assert.equal(evaluateDkim(["v=DKIM1; k=rsa; p="]).result, "FAIL");
  assert.equal(evaluateDkim([]).result, "FAIL");
});

test("MAIL_FROM alan hizalaması (alt alan kabul)", () => {
  assert.equal(evaluateFrom("KararVer <no-reply@kararver.app>", "kararver.app").result, "PASS");
  assert.equal(evaluateFrom("no-reply@mail.kararver.app", "kararver.app").result, "PASS");
  assert.equal(evaluateFrom("KararVer <no-reply@baska.com>", "kararver.app").result, "FAIL");
  assert.equal(evaluateFrom("geçersiz", "kararver.app").result, "FAIL");
});

test("DNS sorguları sahte çözücüyle; MX yoksa yalnız uyarı", async () => {
  const records = {
    "kararver.app": [["v=spf1 include:_spf.x -all"]],
    "_dmarc.kararver.app": [["v=DMARC1; p=quarantine"]],
    "s1._domainkey.kararver.app": [["v=DKIM1; k=rsa; p=", "MIIBIjANBg"]],
  };
  const dns = {
    resolveTxt: async (name) => {
      if (!records[name]) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
      return records[name];
    },
    resolveMx: async () => [],
  };
  const checks = await checkMailReadiness({ domain: "kararver.app", selector: "s1", from: "KararVer <no-reply@kararver.app>" }, dns);
  const byId = Object.fromEntries(checks.map((c) => [c.id, c.result]));
  // Bölünmüş DKIM TXT parçaları birleştirilir ("p=" + "MIIB…").
  assert.deepEqual(byId, { "dns.spf": "PASS", "dns.dmarc": "PASS", "dns.dkim": "PASS", "mail.from": "PASS", "dns.mx": "WARN" });
});

test("çözücü hatası 'kayıt yok' sayılmaz; kayıt yokluğu (ENODATA) ayrı raporlanır", async () => {
  const fail = (code) => async () => { throw Object.assign(new Error(code), { code }); };
  const refused = await checkMailReadiness({ domain: "kararver.app", selector: "s1", from: "a@kararver.app" }, { resolveTxt: fail("ECONNREFUSED"), resolveMx: fail("ECONNREFUSED") });
  for (const c of refused.filter((x) => x.id.startsWith("dns."))) assert.ok(c.detail.includes("DNS sorgusu yapılamadı (ECONNREFUSED)"), c.id);
  const absent = await checkMailReadiness({ domain: "kararver.app", selector: "s1", from: "a@kararver.app" }, { resolveTxt: fail("ENODATA"), resolveMx: fail("ENODATA") });
  assert.equal(absent.find((c) => c.id === "dns.spf").detail, "SPF kaydı yok");
  assert.equal(absent.find((c) => c.id === "dns.mx").result, "WARN");
});

test("SMTP: STARTTLS sunmayan sunucu FAIL; çok satırlı EHLO okunur; kimlik bilgisi gönderilmez", async () => {
  const received = [];
  const server = net.createServer((socket) => {
    socket.write("220 sahte.smtp ESMTP\r\n");
    socket.on("data", (d) => {
      const line = d.toString();
      received.push(line);
      if (/^EHLO/i.test(line)) socket.write("250-sahte.smtp\r\n250-SIZE 1000\r\n250 AUTH PLAIN LOGIN\r\n");
      if (/^QUIT/i.test(line)) socket.end("221 bye\r\n");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    const checks = await checkSmtp("127.0.0.1", port, { timeoutMs: 3_000 });
    assert.deepEqual(checks.map((c) => [c.id, c.result]), [["smtp.starttls", "FAIL"]]);
    assert.ok(received.every((l) => !/AUTH|MAIL FROM|RCPT/i.test(l)), "oturum açılmaz, mail gönderilmez");
  } finally {
    server.close();
  }
});

test("SMTP: ulaşılamayan sunucu FAIL (zaman aşımı/bağlantı hatası)", async () => {
  const checks = await checkSmtp("127.0.0.1", 1, { timeoutMs: 2_000 });
  assert.equal(checks[0].result, "FAIL");
});
