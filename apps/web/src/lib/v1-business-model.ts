/**
 * KararVer V1 işletmeci ürün kararı (8 Kasım 2026).
 *
 * Bu karar yalnız ürünün gelir modelidir; hukuki uyum, vergi veya işletmeci
 * kimliği kabulünün yerine geçmez. Değiştirmek için yeni işletmeci kararı,
 * #285 hukuki incelemesi ve #54 release kapısı gerekir.
 */
export const V1_BUSINESS_MODEL = Object.freeze({
  release: "v1",
  access: "free",
  advertisingEnabled: false,
  sponsoredPollsEnabled: false,
  paidMembershipsEnabled: false,
  subscriptionsEnabled: false,
  inAppPurchasesEnabled: false,
  paymentsEnabled: false,
  paidPointsEnabled: false,
  pointsCashOutEnabled: false,
  marketingEmailsEnabled: false,
} as const);

/** UI için tek kaynak; gerçek para ile alınıp satılamayan puanlar hariç. */
export const V1_FREE_NOTE = "KararVer V1 ücretsiz ve reklamsızdır. Uygulama içi puanlar parayla satılmaz.";
