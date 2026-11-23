"""A fake bark-server for tests and the e2e harness.

Records every request body to a JSONL file so the e2e script can assert on what
Hermes actually sent, and can inject failures (status codes, slow responses) to
exercise the retry policy.

    python3 tests/fake_bark.py --port 18080 --log /tmp/bark.jsonl
"""

from __future__ import annotations

import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class FakeBark:
    def __init__(self, *, log_path: str = "", port: int = 0):
        self.log_path = log_path
        self.requests: list[dict] = []
        self.fail_queue: list[tuple[int, dict]] = []  # (status, headers) consumed per POST
        self.delay = 0.0
        self._server = ThreadingHTTPServer(("127.0.0.1", port), _Handler)
        self._server.owner = self  # type: ignore[attr-defined]
        self.thread: threading.Thread | None = None

    @property
    def server(self) -> str:
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}"

    def start(self) -> "FakeBark":
        self.thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self.thread.start()
        return self

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        if self.thread:
            self.thread.join(timeout=2)

    def record(self, entry: dict) -> None:
        self.requests.append(entry)
        if self.log_path:
            with open(self.log_path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def __enter__(self) -> "FakeBark":
        return self.start()

    def __exit__(self, *exc) -> None:
        self.stop()


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args) -> None:  # silence the default stderr spam
        return

    def _json(self, status: int, payload: dict, headers: dict | None = None) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for key, value in (headers or {}).items():
            self.send_header(key, str(value))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        owner: FakeBark = self.server.owner  # type: ignore[attr-defined]
        if self.path.rstrip("/") == "/ping":
            self._json(200, {"code": 200, "message": "pong", "version": "2.2.5"})
            return
        self._json(404, {"code": 404, "message": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        owner: FakeBark = self.server.owner  # type: ignore[attr-defined]
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            payload = {"_raw": raw.decode("utf-8", "replace")}

        if owner.delay:
            time.sleep(owner.delay)

        status, headers = (owner.fail_queue.pop(0) if owner.fail_queue else (200, {}))
        owner.record({"path": self.path, "payload": payload, "status": status,
                      "auth": self.headers.get("authorization", "")})

        if status != 200:
            self._json(status, {"code": status, "message": f"injected {status}"}, headers)
            return
        self._json(200, {"code": 200, "message": "success", "timestamp": int(time.time() * 1000),
                         "id": "fake-" + str(len(owner.requests))})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=18080)
    parser.add_argument("--log", default="")
    args = parser.parse_args()
    server = FakeBark(log_path=args.log, port=args.port).start()
    print(f"fake bark listening on {server.server} (log={args.log or '-'})", flush=True)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        server.stop()


if __name__ == "__main__":
    main()
