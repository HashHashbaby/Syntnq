"""Local server for the glass-lens WebGL prototype.

- ``/``            -> ``scripts/lens_glass/`` (the prototype page)
- ``/data/*``      -> ``out/lens/data/`` (exported colours and live frames)
- ``/params.json`` -> ``render.glass`` and ``live.glass`` from the current config
- ``POST /save?name=x.png`` -> writes the request body to ``out/lens/shots/x.png``

Bound to 127.0.0.1 only. Used to drive and capture the renderer from a real-GPU browser.
"""

from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from _corpus import ROOT

from synesthesia.config import load_config

PAGE_DIR = ROOT / "scripts" / "lens_glass"
DATA_DIR = ROOT / "out" / "lens" / "data"
SHOT_DIR = ROOT / "out" / "lens" / "shots"
TYPES = {".html": "text/html", ".js": "text/javascript", ".json": "application/json",
         ".glsl": "text/plain", ".f32": "application/octet-stream"}  # fmt: skip


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, ctype: str = "text/plain") -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/params.json":
            cfg = load_config()
            doc = {"render": cfg.render.glass.model_dump(), "live": cfg.live.glass.model_dump(),
                   "bloom_sigma_flat": cfg.render.glow_sigma_ratio}  # fmt: skip
            self._send(200, json.dumps(doc).encode(), "application/json")
            return
        if path.startswith("/data/"):
            target = DATA_DIR / Path(path).name
        else:
            target = PAGE_DIR / (Path(path).name or "index.html")
        if not target.is_file():
            self._send(404, b"not found")
            return
        self._send(200, target.read_bytes(), TYPES.get(target.suffix, "application/octet-stream"))

    def do_POST(self) -> None:  # noqa: N802
        url = urlparse(self.path)
        if url.path != "/save":
            self._send(404, b"not found")
            return
        name = Path(parse_qs(url.query).get("name", ["shot.png"])[0]).name
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        SHOT_DIR.mkdir(parents=True, exist_ok=True)
        (SHOT_DIR / name).write_bytes(body)
        self._send(200, b"ok")

    def log_message(self, fmt: str, *args: object) -> None:  # keep the console quiet
        return


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=8766)
    args = ap.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    sys.stdout.write(f"serving on http://127.0.0.1:{args.port}\n")
    sys.stdout.flush()
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
