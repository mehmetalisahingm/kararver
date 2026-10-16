/**
 * #51 gerçek SMTP hazırlık kontrolü (kapalı beta öncesi). Kimlik bilgisi KULLANMAZ ve yazdırmaz; mail göndermez.
 *   node scripts/mail-readiness.mjs --domain <alan> --dkim-selector <seçici> --from "KararVer <no-reply@alan>" \
 *     [--smtp-host smtp.saglayici.com] [--smtp-port 587] [--dns-server 1.1.1.1]
 * Denetler: SPF (tek kayıt, +all yok), DMARC (p=none uyarı), DKIM (seçicide açık anahtar), MAIL_FROM alan uyumu,
 * SMTP sunucusu: banner → EHLO → STARTTLS (587) ya da doğrudan TLS (465) → geçerli sertifika → AUTH ilanı.
 * Çıkış kodu: herhangi bir FAIL varsa 1. Gerçek teslim (Gmail/Outlook gelen kutusu, spam klasörü) ayrıca elle doğrulanır.
 */
import { Resolver } from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const txt = (records) => records.map((chunks) => chunks.join(""));

/** SPF: tek v=spf1 kaydı; "+all" herkese izin verir (FAIL), "?all" etkisizdir (WARN). */
export function evaluateSpf(records) {
  const spf = records.filter((r) => /^v=spf1(\s|$)/i.test(r));
  if (spf.length === 0) return { result: "FAIL", detail: "SPF kaydı yok" };
  if (spf.length > 1) return { result: "FAIL", detail: `${spf.length} SPF kaydı var (tek olmalı)` };
  const all = spf[0].match(/(^|\s)([+?~-]?)all(\s|$)/i);
  // redirect= politikayı başka bir kayda devreder (ör. sağlayıcının SPF'i); orada değerlendirilir.
  const redirect = spf[0].match(/(^|\s)redirect=(\S+)/i)?.[2];
  if (!all && redirect) return { result: "PASS", detail: `SPF ${redirect} kaydına yönlendiriyor` };
  if (!all) return { result: "WARN", detail: "SPF 'all' ile bitmiyor" };
  const q = all[2] || "+";
  if (q === "+") return { result: "FAIL", detail: "SPF '+all': herkes bu alan adından gönderebilir" };
  if (q === "?") return { result: "WARN", detail: "SPF '?all': etkisiz" };
  return { result: "PASS", detail: `SPF var (${q}all)` };
}

/** DMARC: p=none yalnız izleme (WARN); quarantine/reject PASS. */
export function evaluateDmarc(records) {
  const dmarc = records.filter((r) => /^v=DMARC1(\s*;|$)/i.test(r));
  if (dmarc.length !== 1) return { result: "FAIL", detail: dmarc.length === 0 ? "DMARC kaydı yok" : "birden çok DMARC kaydı" };
  const policy = dmarc[0].match(/(?:^|;)\s*p\s*=\s*(none|quarantine|reject)/i)?.[1]?.toLowerCase();
  if (!policy) return { result: "FAIL", detail: "DMARC politikası (p=) yok" };
  if (policy === "none") return { result: "WARN", detail: "DMARC p=none: yalnız izleme; beta sonrası quarantine/reject" };
  return { result: "PASS", detail: `DMARC p=${policy}` };
}

/** DKIM: seçicide boş olmayan açık anahtar (p=). Boş p= iptal edilmiş anahtardır. */
export function evaluateDkim(records) {
  const rec = records.find((r) => /(^|;)\s*p\s*=/i.test(r));
  if (!rec) return { result: "FAIL", detail: "DKIM kaydı yok" };
  const key = rec.match(/(?:^|;)\s*p\s*=\s*([^;\s]*)/i)?.[1] ?? "";
  if (key.length === 0) return { result: "FAIL", detail: "DKIM anahtarı boş (iptal edilmiş)" };
  return { result: "PASS", detail: `DKIM anahtarı var (${key.length} karakter)` };
}

/** MAIL_FROM adresinin alanı, doğrulanan alan ya da alt alanı olmalı (DMARC hizalaması). */
export function evaluateFrom(from, domain) {
  const address = from.match(/<([^<>]+)>\s*$/)?.[1] ?? from.trim();
  const host = address.split("@")[1]?.toLowerCase();
  if (!host) return { result: "FAIL", detail: "MAIL_FROM geçerli bir adres değil" };
  const d = domain.toLowerCase();
  return host === d || host.endsWith(`.${d}`)
    ? { result: "PASS", detail: `MAIL_FROM alanı ${host}` }
    : { result: "FAIL", detail: `MAIL_FROM alanı (${host}) ${d} ile hizalı değil` };
}

/** Satır satır SMTP okuyucu: çok satırlı cevabın ("250-…") son satırına ("250 …") kadar bekler. */
function reader(socket) {
  let buffer = "";
  let waiting = null;
  const tryResolve = () => {
    if (!waiting) return;
    const lines = buffer.split("\r\n");
    const end = lines.findIndex((l) => /^\d{3} /.test(l));
    if (end === -1) return;
    const reply = lines.slice(0, end + 1);
    buffer = lines.slice(end + 1).join("\r\n");
    const w = waiting;
    waiting = null;
    w.resolve({ code: Number(reply[end].slice(0, 3)), lines: reply });
  };
  const onData = (chunk) => {
    buffer += chunk.toString("utf8");
    tryResolve();
  };
  socket.on("data", onData);
  return {
    next: (timeoutMs) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("SMTP cevabı zaman aşımı")), timeoutMs);
        waiting = { resolve: (v) => (clearTimeout(timer), resolve(v)) };
        tryResolve();
      }),
    detach: () => socket.off("data", onData),
  };
}

/** SMTP: banner, EHLO, STARTTLS (ya da 465'te doğrudan TLS), sertifika doğrulaması, AUTH ilanı. Oturum açılmaz. */
export async function checkSmtp(host, port, { timeoutMs = 10_000, connect = net.connect, tlsConnect = tls.connect } = {}) {
  const checks = [];
  const add = (id, result, detail) => checks.push({ id, result, detail });
  const implicitTls = port === 465;
  let socket;
  try {
    socket = await new Promise((resolve, reject) => {
      const s = implicitTls ? tlsConnect({ host, port, servername: host }) : connect({ host, port });
      const timer = setTimeout(() => (s.destroy(), reject(new Error("bağlantı zaman aşımı"))), timeoutMs);
      s.once(implicitTls ? "secureConnect" : "connect", () => (clearTimeout(timer), resolve(s)));
      s.once("error", (e) => (clearTimeout(timer), reject(e)));
    });
    let r = reader(socket);
    const banner = await r.next(timeoutMs);
    if (banner.code !== 220) throw new Error(`banner ${banner.code}`);
    socket.write("EHLO mail-readiness.kararver\r\n");
    let ehlo = await r.next(timeoutMs);
    if (!implicitTls) {
      if (!ehlo.lines.some((l) => /STARTTLS/i.test(l))) {
        add("smtp.starttls", "FAIL", "sunucu STARTTLS sunmuyor (staging/production TLS zorunlu)");
        return checks;
      }
      socket.write("STARTTLS\r\n");
      const ready = await r.next(timeoutMs);
      if (ready.code !== 220) throw new Error(`STARTTLS ${ready.code}`);
      r.detach();
      socket = await new Promise((resolve, reject) => {
        const s = tlsConnect({ socket, servername: host });
        s.once("secureConnect", () => resolve(s));
        s.once("error", reject);
      });
      r = reader(socket);
      socket.write("EHLO mail-readiness.kararver\r\n");
      ehlo = await r.next(timeoutMs);
    }
    // tls.connect varsayılanı rejectUnauthorized: true; buraya geldiysek sertifika geçerli.
    add("smtp.tls", "PASS", `${implicitTls ? "doğrudan TLS" : "STARTTLS"} ve geçerli sertifika (${socket.getProtocol?.() ?? "TLS"})`);
    add("smtp.auth", ehlo.lines.some((l) => /\bAUTH\b/i.test(l)) ? "PASS" : "FAIL", "TLS sonrası AUTH ilanı");
    socket.write("QUIT\r\n");
  } catch (err) {
    add("smtp.connect", "FAIL", `SMTP kontrolü başarısız: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    socket?.destroy();
  }
  return checks;
}

/** Kaydın olmaması (ENODATA/ENOTFOUND) ile sorgunun yapılamaması ayrıdır: çözücü hatası "kayıt yok" diye raporlanmaz. */
const ABSENT = new Set(["ENODATA", "ENOTFOUND"]);

export async function checkMailReadiness({ domain, selector, from, smtpHost, smtpPort = 587 }, dns = new Resolver()) {
  const checks = [];
  const lookup = async (id, name, evaluate) => {
    try {
      checks.push({ id, ...evaluate(txt(await dns.resolveTxt(name))) });
    } catch (err) {
      const code = err?.code ?? "hata";
      checks.push(ABSENT.has(code) ? { id, ...evaluate([]) } : { id, result: "FAIL", detail: `DNS sorgusu yapılamadı (${code}); --dns-server ile tekrar dene` });
    }
  };
  await lookup("dns.spf", domain, evaluateSpf);
  await lookup("dns.dmarc", `_dmarc.${domain}`, evaluateDmarc);
  await lookup("dns.dkim", `${selector}._domainkey.${domain}`, evaluateDkim);
  checks.push({ id: "mail.from", ...evaluateFrom(from, domain) });
  try {
    const mx = await dns.resolveMx(domain);
    checks.push({ id: "dns.mx", result: mx.length ? "PASS" : "WARN", detail: mx.length ? `${mx.length} MX (geri dönen mailler için)` : "MX yok: geri dönen mailler kaybolur" });
  } catch (err) {
    const code = err?.code ?? "hata";
    checks.push(ABSENT.has(code) ? { id: "dns.mx", result: "WARN", detail: "MX yok: geri dönen mailler kaybolur" } : { id: "dns.mx", result: "FAIL", detail: `DNS sorgusu yapılamadı (${code})` });
  }
  if (smtpHost) checks.push(...(await checkSmtp(smtpHost, smtpPort)));
  return checks;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { values } = parseArgs({
    options: {
      domain: { type: "string" },
      "dkim-selector": { type: "string" },
      from: { type: "string" },
      "smtp-host": { type: "string" },
      "smtp-port": { type: "string", default: "587" },
      "dns-server": { type: "string" },
    },
  });
  if (!values.domain || !values["dkim-selector"] || !values.from) {
    console.error('kullanım: --domain <alan> --dkim-selector <seçici> --from "Ad <adres>" [--smtp-host <sunucu>] [--smtp-port 587|465]');
    process.exit(2);
  }
  const resolver = new Resolver();
  if (values["dns-server"]) resolver.setServers([values["dns-server"]]);
  const checks = await checkMailReadiness(
    { domain: values.domain, selector: values["dkim-selector"], from: values.from, smtpHost: values["smtp-host"], smtpPort: Number(values["smtp-port"]) },
    resolver,
  );
  for (const c of checks) console.log(`${c.result.padEnd(4)} ${c.id.padEnd(14)} ${c.detail}`);
  const failed = checks.filter((c) => c.result === "FAIL").length;
  console.log(failed ? `\nSONUÇ: ${failed} FAIL — gerçek SMTP hazır değil` : "\nSONUÇ: DNS ve SMTP hazır; gerçek gelen kutusu teslimini (Gmail, Outlook, spam) elle doğrula");
  process.exitCode = failed ? 1 : 0;
}
