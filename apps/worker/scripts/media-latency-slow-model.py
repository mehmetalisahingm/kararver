"""media-latency.ts için sahte yavaş model: moderate.py ile aynı protokol, görsel başına sabit gecikme (varsayılan 400 ms)."""

import json
import os
import sys
import time

DELAY = float(os.environ.get("SLOW_MODEL_DELAY", "0.4"))

sys.stdout.write(json.dumps({"ready": True}) + "\n")
sys.stdout.flush()
for line in sys.stdin:
    time.sleep(DELAY)
    sys.stdout.write(json.dumps({"id": json.loads(line)["id"], "ok": True, "detections": []}) + "\n")
    sys.stdout.flush()
