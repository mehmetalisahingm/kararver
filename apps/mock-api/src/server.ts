// Mock API giriş noktası: pnpm mock:dev (varsayılan http://127.0.0.1:4010/v1).
// Web'i mock'a bağlamak için API taban adresi bu porta verilir; production'da açılmaz.
import { buildMockApp } from "./app.ts";

const port = Number(process.env.MOCK_PORT ?? 4010);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Mock API yapılandırması geçersiz → MOCK_PORT 1-65535 arası tam sayı olmalı");
}

const app = buildMockApp();

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "kapanıyor");
  await app.close();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: "127.0.0.1", port });
