"""Download the exact BF16 model used by the reference site, with resumable chunks."""
import concurrent.futures
import json
import os
from pathlib import Path
import shutil
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
MODEL = ROOT / "model"
MODEL.mkdir(exist_ok=True)
URL = "https://mlx.void.app/api/model/model.safetensors"
SIZE = 1706030600
CHUNK = 16 * 1024 * 1024
CACHE = Path(tempfile.gettempdir()) / "how-llms-work-model-c2915819"
CACHE.mkdir(exist_ok=True)
DEST = MODEL / "model.safetensors"

def get_chunk(index):
    start = index * CHUNK
    end = min(start + CHUNK, SIZE) - 1
    target = CACHE / f"{index:04d}.chunk"
    expected = end - start + 1
    if target.is_file() and target.stat().st_size == expected:
        return expected
    for attempt in range(3):
        try:
            req = urllib.request.Request(URL, headers={
                "Range": f"bytes={start}-{end}", "User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=90) as response:
                if response.status != 206:
                    raise RuntimeError(f"Server did not honor Range: {response.status}")
                if response.headers.get("Content-Range") != f"bytes {start}-{end}/{SIZE}":
                    raise RuntimeError("Unexpected Content-Range")
                with target.open("wb") as output:
                    shutil.copyfileobj(response, output, 1024 * 1024)
            if target.stat().st_size != expected:
                raise RuntimeError("Incomplete model chunk")
            return expected
        except Exception:
            if attempt == 2:
                raise
    return 0

def main():
    if DEST.is_file() and DEST.stat().st_size == SIZE:
        print("Model already downloaded:", DEST, flush=True)
        return
    count = (SIZE + CHUNK - 1) // CHUNK
    started = time.monotonic()
    done = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        futures = [pool.submit(get_chunk, i) for i in range(count)]
        for future in concurrent.futures.as_completed(futures):
            done += future.result()
            if done // CHUNK % 4 == 0 or done == SIZE:
                print(f"{done / SIZE:.1%} — {done / 1024**2:.0f} / {SIZE / 1024**2:.0f} MiB",
                      flush=True)
    assembled = CACHE / "model.safetensors"
    with assembled.open("wb") as output:
        for index in range(count):
            with (CACHE / f"{index:04d}.chunk").open("rb") as source:
                shutil.copyfileobj(source, output, 1024 * 1024)
    # Validate safetensors metadata and tensor boundaries before exposing the model.
    with assembled.open("rb") as source:
        header_length = int.from_bytes(source.read(8), "little")
        if not 0 < header_length < 16 * 1024 * 1024:
            raise RuntimeError("Invalid safetensors header")
        header = json.loads(source.read(header_length))
    for name, tensor in header.items():
        if name == "__metadata__":
            continue
        begin, end = tensor["data_offsets"]
        if not 0 <= begin <= end <= SIZE - 8 - header_length:
            raise RuntimeError(f"Invalid tensor bounds: {name}")
    shutil.move(assembled, DEST)
    for part in CACHE.glob("*.chunk"):
        part.unlink()
    print(f"Ready: {DEST} ({len(header)} entries, {time.monotonic() - started:.0f}s)", flush=True)

if __name__ == "__main__":
    main()
