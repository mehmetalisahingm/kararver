export type ShareChannel = "x" | "whatsapp" | "copy" | "other";

export type ShareLinkRecord = {
  id: string;
  canonicalPath: string;
};

export interface ShareStore {
  /**
   * Yalnız public görünür (ACTIVE/LOCKED) gönderi için kaynak kaydı oluşturur.
   * Görünürlük satırı transaction içinde FOR SHARE ile kilitlenir; moderasyonla yarışta
   * görünmez bir içerik için yeni paylaşım linki üretilemez.
   */
  create(pollId: string, channel: ShareChannel): Promise<ShareLinkRecord | null>;
}
