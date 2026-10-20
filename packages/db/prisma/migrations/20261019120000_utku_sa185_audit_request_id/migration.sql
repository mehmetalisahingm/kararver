-- #185 admin.audit.list `requestId` süzgeci (X-Request-Id, tam eşleşme). Index yokken sorgu bütün tabloyu tarar
-- (500 bin satırda paralel seq scan, ~24 ms, tabloyla doğrusal büyür); index ile ~0,05 ms. Kısmi: CLI/worker
-- kayıtlarında request_id NULL'dur ve süzgeçte aranmaz. Prisma şemasında ifade edilmez (kısmi index), elle yönetilir;
-- schema/admin.prisma AuditLog notuna bakın. `reasonContains` için index yok: sözleşme from/to'yu (≤ 31 gün) zorunlu
-- kılar, arama audit_logs_created_at_idx aralığında kalır (EXPLAIN: PR #185 dilim 1 açıklaması).
CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs" ("request_id") WHERE "request_id" IS NOT NULL;
