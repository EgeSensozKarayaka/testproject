from __future__ import annotations

import json
import signal
import threading
from collections.abc import Mapping
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Literal

from .config import Settings, load_settings
from .health import database_ready, health_payload


class HealthHandler(BaseHTTPRequestHandler):
    settings: Settings

    def do_GET(self) -> None:
        if self.path == "/health/live":
            self._send(
                HTTPStatus.OK,
                health_payload(self.settings.service_name, self.settings.version, "ok"),
            )
            return
        if self.path == "/health/ready":
            ready = database_ready(self.settings.database_url)
            status: Literal["ok", "unavailable"] = "ok" if ready else "unavailable"
            self._send(
                HTTPStatus.OK if ready else HTTPStatus.SERVICE_UNAVAILABLE,
                health_payload(self.settings.service_name, self.settings.version, status),
            )
            return
        self._send(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def log_message(self, message_format: str, *args: Any) -> None:
        print(json.dumps({"level": "info", "message": message_format % args}))

    def _send(self, status: HTTPStatus, body: Mapping[str, object]) -> None:
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    settings = load_settings()
    HealthHandler.settings = settings
    server = ThreadingHTTPServer((settings.host, settings.port), HealthHandler)

    def stop(_signum: int, _frame: object) -> None:
        # BaseServer.shutdown must run on a different thread than serve_forever.
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    print(
        json.dumps(
            {
                "level": "info",
                "message": "predictor health service started",
                "port": settings.port,
                "service": settings.service_name,
                "version": settings.version,
            }
        )
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
