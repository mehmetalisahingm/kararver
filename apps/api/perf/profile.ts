// KV-47 (#49) yük profili: seed ve yük betiklerinin ortak sabitleri.
// Kabul profili (#49): 10.000 anket (burada 9.000 anket + 1.000 tartışma), 100.000 oy, 50 eşzamanlı kullanıcı.
export const PERF = {
  users: 4000,
  /** İlk `authors` kullanıcı gönderi açar, diğerleri oy verir: yazar kendi anketine oy veremez (trigger). */
  authors: 500,
  polls: 9000,
  discussions: 1000,
  votes: 100_000,
  comments: 20_000,
  /** Yük testinde giriş yapan kullanıcıların şifresi (sadece _perf veritabanında). */
  password: "perf-yuk-testi-sifresi",
} as const;
