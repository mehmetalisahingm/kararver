"""KV-08 spike — NudeNet (ONNX) için gecikme/kaynak ölçümü.

Çıktı: docs/MEDIA_MODERATION.md §3'teki tabloların kaynağı olan
results.json. Bulgular ve yorum için docs/MEDIA_MODERATION.md'ye bakın.
"""

import json
import os
import time

import psutil
from nudenet import NudeDetector

SAMPLES = os.path.join(os.path.dirname(__file__), "samples")
OUT_FILE = os.path.join(os.path.dirname(__file__), "results.json")


def main() -> None:
    proc = psutil.Process(os.getpid())
    rss_before = proc.memory_info().rss

    t0 = time.perf_counter()
    detector = NudeDetector()
    init_latency_ms = (time.perf_counter() - t0) * 1000
    rss_after_init = proc.memory_info().rss

    per_image = {}
    timings = []
    for fname in sorted(os.listdir(SAMPLES)):
        path = os.path.join(SAMPLES, fname)
        t0 = time.perf_counter()
        detections = detector.detect(path)
        dt_ms = (time.perf_counter() - t0) * 1000
        timings.append(dt_ms)
        per_image[fname] = {
            "latency_ms": round(dt_ms, 1),
            "detections": detections,
        }

    rss_after_runs = proc.memory_info().rss
    warm = timings[1:] or timings

    result = {
        "model": "nudenet==3.4.2 (320n.onnx, ~11.6MB, bundled MIT model)",
        "runtime": "onnxruntime==1.30.0 (CPUExecutionProvider)",
        "init_latency_ms": round(init_latency_ms, 1),
        "per_image_latency_ms": {k: v["latency_ms"] for k, v in per_image.items()},
        "avg_warm_latency_ms": round(sum(warm) / len(warm), 1),
        "rss_before_mb": round(rss_before / 1024 / 1024, 1),
        "rss_after_model_load_mb": round(rss_after_init / 1024 / 1024, 1),
        "rss_after_inference_mb": round(rss_after_runs / 1024 / 1024, 1),
        "detections_by_image": {k: v["detections"] for k, v in per_image.items()},
    }

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, default=str, ensure_ascii=False)

    print(json.dumps(result, indent=2, default=str, ensure_ascii=False))


if __name__ == "__main__":
    main()
