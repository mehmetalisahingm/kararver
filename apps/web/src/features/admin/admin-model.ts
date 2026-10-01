export type AdminRole = "USER" | "MODERATOR" | "ADMIN" | "SUPER_ADMIN";

export const adminSections = [
  "dashboard",
  "users",
  "polls",
  "comments",
  "reports",
  "media",
  "categories",
  "communities",
  "featured",
  "settings",
  "audit",
] as const;

export type AdminSectionId = (typeof adminSections)[number];

export type AdminNavItem = {
  id: AdminSectionId;
  href: string;
  label: string;
  description: string;
  roles: AdminRole[];
};

const adminOnly: AdminRole[] = ["ADMIN", "SUPER_ADMIN"];
const moderation: AdminRole[] = ["MODERATOR", "ADMIN", "SUPER_ADMIN"];

export const adminNav: AdminNavItem[] = [
  { id: "dashboard", href: "/admin", label: "Dashboard", description: "Sistem özeti ve operasyon durumu", roles: adminOnly },
  { id: "users", href: "/admin/users", label: "Kullanıcılar", description: "Hesaplar, roller ve yaptırımlar", roles: adminOnly },
  { id: "polls", href: "/admin/polls", label: "İçerikler", description: "Anket ve tartışma moderasyonu", roles: moderation },
  { id: "comments", href: "/admin/comments", label: "Yorumlar", description: "Yorum ve cevap moderasyonu", roles: moderation },
  { id: "reports", href: "/admin/reports", label: "Raporlar", description: "Moderasyon kuyruğu", roles: moderation },
  { id: "media", href: "/admin/media", label: "Medya", description: "Görsel inceleme ve karantina", roles: moderation },
  { id: "categories", href: "/admin/categories", label: "Kategoriler", description: "Kategori sırası ve aktiflik", roles: adminOnly },
  { id: "communities", href: "/admin/communities", label: "Topluluklar", description: "Topluluk yönetimi", roles: moderation },
  { id: "featured", href: "/admin/featured", label: "Öne çıkarılanlar", description: "Öne çıkarma ve duyurular", roles: adminOnly },
  { id: "settings", href: "/admin/settings", label: "Ayarlar", description: "Sistem ve acil durum anahtarları", roles: adminOnly },
  { id: "audit", href: "/admin/audit", label: "Audit", description: "Değiştirilemez yönetim geçmişi", roles: adminOnly },
];

export function isAdminSection(value: string): value is AdminSectionId {
  return (adminSections as readonly string[]).includes(value);
}

export function canSeeAdminItem(roles: readonly AdminRole[], item: AdminNavItem) {
  return item.roles.some((role) => roles.includes(role));
}

export function canEnterAdmin(roles: readonly AdminRole[]) {
  return roles.some((role) => role === "MODERATOR" || role === "ADMIN" || role === "SUPER_ADMIN");
}
