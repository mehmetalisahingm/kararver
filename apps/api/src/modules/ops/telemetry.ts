// KV-186 (#186) operasyon telemetrisi: süreç içi kayan pencere (varsayılan 15 dk). Kişisel veri tutmaz: yalnız yöntem,
// route kalıbı (`/v1/polls/:id`), durum kodu ve süre; hız sınırında yalnız kural adı. Süreç yeniden başlayınca sıfırlanır,
// bu yüzden yanıt `scope: "process"` taşır. Ölçüm yoksa oran/gecikme `null` döner (0 değil).

export const OPS_WINDOW_MS = 15 * 60_000;

type RequestSample = { at: number; method: string; route: string; status: number; ms: number };
type DenySample = { at: number; rules: string[]; login: boolean };

export type HttpSnapshot = {
  scope: "process";
  windowMinutes: number;
  requests: number;
  errors5xx: number;
  errorRate: number | null;
  latencyMs: { p50: number; p95: number; p99: number } | null;
  slowest: Array<{ method: string; route: string; count: number; p95Ms: number }>;
};
export type SecuritySnapshot = {
  scope: "process";
  windowMinutes: number;
  rateLimited: number;
  loginLockouts: number;
  byRule: Array<{ rule: string; count: number }>;
};

export type OpsTelemetry = {
  recordRequest(sample: Omit<RequestSample, "at">): void;
  /** Hız sınırı reddi; `login` giriş denemesi kilidi (KV-19 login.email/login.ip). */
  recordRateLimit(rules: string[], login: boolean): void;
  snapshot(): { http: HttpSnapshot; security: SecuritySnapshot };
};

/** Sıralı dizide en yakın sıra yüzdeliği. */
export function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

const round = (ms: number) => Math.round(ms * 10) / 10;

export function createOpsTelemetry(options: { now?: () => number; windowMs?: number; maxSamples?: number; slowestCount?: number } = {}): OpsTelemetry {
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? OPS_WINDOW_MS;
  const maxSamples = options.maxSamples ?? 50_000;
  const slowestCount = options.slowestCount ?? 5;
  const requests: RequestSample[] = [];
  const denies: DenySample[] = [];

  // Örnekler zaman sırasıyla eklenir; pencere dışındakiler baştan atılır, üst sınır belleği korur.
  const prune = <T extends { at: number }>(list: T[]) => {
    const cutoff = now() - windowMs;
    let drop = 0;
    while (drop < list.length && list[drop]!.at < cutoff) drop++;
    if (list.length - drop > maxSamples) drop = list.length - maxSamples;
    if (drop > 0) list.splice(0, drop);
  };

  return {
    recordRequest(sample) {
      requests.push({ ...sample, at: now() });
      if (requests.length > maxSamples * 1.1) prune(requests);
    },
    recordRateLimit(rules, login) {
      denies.push({ at: now(), rules: [...rules], login });
      if (denies.length > maxSamples * 1.1) prune(denies);
    },
    snapshot() {
      prune(requests);
      prune(denies);
      const windowMinutes = Math.round(windowMs / 60_000);
      const durations = requests.map((r) => r.ms).sort((a, b) => a - b);
      const errors5xx = requests.filter((r) => r.status >= 500).length;
      const byRoute = new Map<string, { method: string; route: string; ms: number[] }>();
      for (const r of requests) {
        const key = `${r.method} ${r.route}`;
        const entry = byRoute.get(key) ?? { method: r.method, route: r.route, ms: [] };
        entry.ms.push(r.ms);
        byRoute.set(key, entry);
      }
      const slowest = [...byRoute.values()]
        .map((e) => ({ method: e.method, route: e.route, count: e.ms.length, p95Ms: round(percentile(e.ms.sort((a, b) => a - b), 95)) }))
        .sort((a, b) => b.p95Ms - a.p95Ms || b.count - a.count)
        .slice(0, slowestCount);
      const ruleCounts = new Map<string, number>();
      for (const d of denies) for (const rule of d.rules) ruleCounts.set(rule, (ruleCounts.get(rule) ?? 0) + 1);
      return {
        http: {
          scope: "process",
          windowMinutes,
          requests: requests.length,
          errors5xx,
          errorRate: requests.length > 0 ? errors5xx / requests.length : null,
          latencyMs:
            durations.length > 0
              ? { p50: round(percentile(durations, 50)), p95: round(percentile(durations, 95)), p99: round(percentile(durations, 99)) }
              : null,
          slowest,
        },
        security: {
          scope: "process",
          windowMinutes,
          rateLimited: denies.filter((d) => !d.login).length,
          loginLockouts: denies.filter((d) => d.login).length,
          byRule: [...ruleCounts].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule)),
        },
      };
    },
  };
}
