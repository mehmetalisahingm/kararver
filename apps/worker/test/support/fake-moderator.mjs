// python/moderate.py ile aynı protokolü konuşan sahte alt-süreç. Mod ilk argümandır.
//   ok          → her isteğe görsel boyutuna göre sabit bir tespit döner
//   slow        → cevap vermez (zaman aşımı)
//   never-ready → hiç hazır olmaz
//   crash       → ilk istekte çıkar
//   error       → her isteğe ok:false döner
import { createInterface } from "node:readline";

const mode = process.argv[2] ?? "ok";
const reply = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);

if (mode !== "never-ready") {
  process.stderr.write("fake moderator: model yüklendi\n");
  process.stdout.write("protokol dışı bir satır\n");
  reply({ ready: true });
}
createInterface({ input: process.stdin }).on("line", (line) => {
  const req = JSON.parse(line);
  if (mode === "slow" || mode === "never-ready") return;
  if (mode === "crash") process.exit(3);
  if (mode === "error") return reply({ id: req.id, ok: false, error: "ValueError: bozuk görsel" });
  const size = Buffer.from(req.image, "base64").length;
  reply({ id: req.id, ok: true, detections: [{ class: "FACE_FEMALE", score: 0.9 }, { class: "SIZE", score: size }] });
});
