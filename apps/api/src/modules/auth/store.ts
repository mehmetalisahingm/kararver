// Auth modülünün veri erişim arayüzü. Üretimde PrismaAuthStore kullanılır;
// testler aynı senaryoları bellek içi bir uygulamayla ve (DB varsa) Prisma ile çalıştırır.
// Tek kullanımlık token ve oturum iptali gibi çok adımlı işlemler tek metotta, tek transaction'dadır.

export type UserStatus = "ACTIVE" | "RESTRICTED" | "SUSPENDED" | "BANNED";
export type TokenPurpose = "EMAIL_VERIFICATION" | "PASSWORD_RESET";

export type UserRecord = {
  id: string;
  email: string;
  emailNormalized: string;
  username: string;
  displayName: string;
  passwordHash: string;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  bio: string | null;
  /** Sadece APPROVED avatarın public object key'i; aksi halde null. */
  avatarPublicKey: string | null;
  createdAt: Date;
  deletedAt: Date | null;
};

export type SessionRecord = { id: string; userId: string; expiresAt: Date; revokedAt: Date | null; lastSeenAt: Date | null };

export type NewUser = {
  email: string;
  emailNormalized: string;
  username: string;
  usernameNormalized: string;
  displayName: string;
  passwordHash: string;
};

export type NewToken = { purpose: TokenPurpose; tokenHash: string; expiresAt: Date };

export type ProfilePatch = { displayName?: string; bio?: string | null; avatarMediaId?: string | null };

export type PointLedgerRecord = {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: "INITIAL_GRANT" | "PUBLISH" | "ADMIN_ADJUSTMENT" | "MODERATION_REFUND";
  referenceId: string | null;
  createdAt: Date;
};

export interface AuthStore {
  findUserByEmail(emailNormalized: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  usernameExists(usernameNormalized: string): Promise<boolean>;
  /** Kullanıcı ve ilk doğrulama token'ı birlikte oluşur. Unique çakışmada hangi alanın çakıştığını döner. */
  createUser(user: NewUser, token: NewToken): Promise<{ ok: true; user: UserRecord } | { ok: false; conflict: "email" | "username" }>;
  /** Aynı amaçlı kullanılmamış eski token'ları geçersiz kılar ve yenisini ekler. */
  issueToken(userId: string, token: NewToken, now: Date): Promise<void>;

  /** Oturum + last_login + ilk giriş puanı aynı transaction'da işlenir. */
  createSession(
    session: { userId: string; tokenHash: string; expiresAt: Date; ipAddress: string | null; userAgent: string | null },
    now: Date,
    /** İlk giriş puanı (points.initialGrant, KV-40); verilmezse resmî varsayılan. */
    initialGrant?: number,
  ): Promise<void>;
  findSession(tokenHash: string): Promise<SessionRecord | null>;
  touchSession(id: string, now: Date): Promise<void>;
  revokeSession(id: string, now: Date): Promise<void>;

  /** Token'ı tek seferde tüketir ve e-postayı doğrular. Token geçersiz/süresi dolmuş/kullanılmışsa false. */
  verifyEmail(tokenHash: string, now: Date): Promise<boolean>;
  /** Token'ı tüketir, parolayı değiştirir, bütün oturumları ve diğer sıfırlama token'larını iptal eder. */
  resetPassword(tokenHash: string, passwordHash: string, now: Date): Promise<boolean>;

  /** Kullanıcının kendi, AVATAR amaçlı ve REJECTED olmayan görseli mi? */
  isUsableAvatar(userId: string, mediaId: string): Promise<boolean>;
  updateProfile(userId: string, patch: ProfilePatch): Promise<UserRecord>;

  /** V1 #67: yayın puanı bakiyesi ve append-only hareket listesi. */
  /** publishCost: points.publishCost (KV-40); verilmezse resmî varsayılan. */
  getPointsSummary(userId: string, publishCost?: number): Promise<{ balance: number; publishCost: number }>;
  listPointLedger(
    userId: string,
    after: { createdAt: Date; id: string } | null,
    limit: number,
  ): Promise<PointLedgerRecord[]>;
}
