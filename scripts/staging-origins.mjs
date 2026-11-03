/**
 * #301: staging kabul runner'larının hedefi. Varsayılan güncel Vercel/Render staging; STAGING_WEB_URL ve STAGING_API_URL
 * (workflow'lardaki adlar) ile seçilir. Bu runner'lar gerçek hesap bilgisi gönderir: yalnız aşağıdaki origin'ler kabul edilir,
 * başka her değer (eski Railway dahil) ağa çıkmadan hata verir. Altyapı taşınınca izin listesi burada, incelemeyle değişir.
 * Hata mesajı verilen değeri içermez (yanlışlıkla yapıştırılmış kimlik bilgisi loga düşmesin).
 */
export const STAGING_WEB_ORIGINS = Object.freeze(["https://kararver-staging.vercel.app"]);
export const STAGING_API_ORIGINS = Object.freeze(["https://kararver-api-free-preview.onrender.com"]);

function pick(name, value, allowed) {
  if (value === undefined || value === "") return allowed[0];
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name}: geçerli bir HTTPS staging origin'i değil`); }
  // new URL sondaki "/" dışında yol, sorgu ve kimlik bilgisini korur; bunlar origin karşılaştırmasından kaçmasın.
  const bare = !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  if (!bare || !allowed.includes(url.origin)) throw new Error(`${name}: izin verilen staging origin'i değil (${allowed.join(", ")})`);
  return url.origin;
}

export function stagingOrigins(env = process.env) {
  return { web: pick("STAGING_WEB_URL", env.STAGING_WEB_URL, STAGING_WEB_ORIGINS), api: pick("STAGING_API_URL", env.STAGING_API_URL, STAGING_API_ORIGINS) };
}
