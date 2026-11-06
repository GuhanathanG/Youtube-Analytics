"""Tiny status page for the Space (port 7860): shows the last step; no data, no secrets."""
import http.server
import json
import sys
from pathlib import Path

STATUS = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/pulse-status.json")


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            last = json.loads(STATUS.read_text())
        except Exception:
            last = {"step": "starting"}
        body = json.dumps({"engine": "Creator Pulse", "last": last}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # keep the Space log for the engine's own output
        pass


http.server.ThreadingHTTPServer(("0.0.0.0", 7860), Handler).serve_forever()
