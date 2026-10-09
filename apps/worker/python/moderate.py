"""KararVer görsel moderasyon alt-süreci (docs/MEDIA_MODERATION.md §4).

apps/worker bu betiği uzun ömürlü bir süreç olarak başlatır ve stdin/stdout üzerinden satır
başına bir JSON mesajla konuşur:
  başlangıç  → {"ready": true}
  istek      ← {"id": "1", "image": "<base64>"}
  cevap      → {"id": "1", "ok": true, "detections": [{"class": "...", "score": 0.91}]}
  hata       → {"id": "1", "ok": false, "error": "..."}
stdout sadece protokol içindir; kütüphanelerin çıktısı stderr'e yönlendirilir.
"""

import base64
import json
import sys

protocol = sys.stdout
sys.stdout = sys.stderr

from nudenet import NudeDetector  # noqa: E402  (stdout yönlendirmesinden sonra yüklenmeli)


def reply(message: dict) -> None:
    protocol.write(json.dumps(message) + "\n")
    protocol.flush()


def main() -> None:
    detector = NudeDetector()
    reply({"ready": True})
    for line in sys.stdin:
        if not line.strip():
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            detections = detector.detect(base64.b64decode(request["image"]))
            reply({
                "id": request_id,
                "ok": True,
                "detections": [{"class": d["class"], "score": round(float(d["score"]), 4)} for d in detections],
            })
        except Exception as error:  # modelin hatası tek isteği düşürür, süreci değil
            reply({"id": request_id, "ok": False, "error": f"{type(error).__name__}: {str(error)[:200]}"})


if __name__ == "__main__":
    main()
