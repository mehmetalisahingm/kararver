// Python moderasyon alt-sürecinin istemcisi (docs/MEDIA_MODERATION.md §4, protokol: python/moderate.py).
// Süreç ilk istekte başlar ve açık kalır (model yükleme ~100 ms'yi her görselde ödememek için).
// Zaman aşımında süreç öldürülür; takılmış bir model sonraki işleri bekletmez, sonraki istekte yeniden başlar.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { Detection } from "./policy.ts";

export interface Moderator {
  classify(image: Buffer): Promise<Detection[]>;
  close(): Promise<void>;
}

export class ModerationTimeoutError extends Error {}
export class ModerationFailedError extends Error {}

export type SubprocessOptions = {
  command: string;
  args: string[];
  /** Görsel başına (MEDIA_MODERATION §6.2: 8 sn). */
  timeoutMs: number;
  /** Süreç başlayıp model yüklenene kadar. */
  startupTimeoutMs: number;
  onStderr?: (line: string) => void;
};

type Pending = { resolve(d: Detection[]): void; reject(e: Error): void; timer: NodeJS.Timeout };

export function createSubprocessModerator(options: SubprocessOptions): Moderator {
  let child: ChildProcessWithoutNullStreams | null = null;
  let ready: Promise<void> | null = null;
  let nextId = 0;
  const pending = new Map<string, Pending>();

  function failAll(error: Error): void {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(error);
      pending.delete(id);
    }
  }

  function stop(): void {
    const c = child;
    child = null;
    ready = null;
    if (c && c.exitCode === null) c.kill("SIGKILL");
  }

  function start(): Promise<void> {
    const c = spawn(options.command, options.args, { stdio: ["pipe", "pipe", "pipe"] });
    child = c;
    // Ölmüş sürece yazmak EPIPE üretir; sonucu 'exit' işleyicisi bildirir, hata worker'ı düşürmemeli.
    c.stdin.on("error", () => {});
    return new Promise<void>((resolve, reject) => {
      const startup = setTimeout(() => {
        stop();
        reject(new ModerationTimeoutError("moderasyon süreci zamanında hazır olmadı"));
      }, options.startupTimeoutMs);

      c.on("error", (err) => {
        clearTimeout(startup);
        if (child === c) stop();
        reject(new ModerationFailedError(`moderasyon süreci başlatılamadı: ${err.message}`));
        failAll(new ModerationFailedError(err.message));
      });
      c.on("exit", (code, signal) => {
        clearTimeout(startup);
        if (child === c) {
          child = null;
          ready = null;
        }
        const error = new ModerationFailedError(`moderasyon süreci kapandı (code=${code}, signal=${signal})`);
        reject(error);
        failAll(error);
      });
      createInterface({ input: c.stderr }).on("line", (line) => options.onStderr?.(line));
      createInterface({ input: c.stdout }).on("line", (line) => {
        let message: { ready?: boolean; id?: string; ok?: boolean; detections?: Detection[]; error?: string };
        try {
          message = JSON.parse(line);
        } catch {
          options.onStderr?.(`protokol dışı çıktı: ${line.slice(0, 200)}`);
          return;
        }
        if (message.ready) {
          clearTimeout(startup);
          resolve();
          return;
        }
        const p = message.id !== undefined ? pending.get(message.id) : undefined;
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(message.id!);
        if (message.ok && Array.isArray(message.detections)) p.resolve(message.detections);
        else p.reject(new ModerationFailedError(message.error ?? "moderasyon hatası"));
      });
    });
  }

  return {
    async classify(image) {
      if (!ready) ready = start();
      try {
        await ready;
      } catch (err) {
        ready = null;
        throw err;
      }
      const c = child!;
      const id = String(++nextId);
      return new Promise<Detection[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new ModerationTimeoutError(`moderasyon ${options.timeoutMs} ms içinde cevap vermedi`));
          if (child === c) stop();
        }, options.timeoutMs);
        pending.set(id, { resolve, reject, timer });
        c.stdin.write(`${JSON.stringify({ id, image: image.toString("base64") })}\n`);
      });
    },
    async close() {
      failAll(new ModerationFailedError("moderatör kapatıldı"));
      stop();
    },
  };
}
