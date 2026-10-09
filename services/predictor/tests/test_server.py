from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from typing import cast

import pytest

import site_monitor_predictor.__main__ as server_module
from site_monitor_predictor.config import Settings


class HealthTestHandler(server_module.HealthHandler):
    pass


@pytest.fixture
def health_server_port() -> Iterator[int]:
    HealthTestHandler.settings = Settings(
        database_url="postgresql://user:pass@postgres/database",
        host="127.0.0.1",
        port=0,
        service_name="predictor-test",
        version="0.1.0-test",
    )
    server = ThreadingHTTPServer(("127.0.0.1", 0), HealthTestHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    yield server.server_port

    server.shutdown()
    server.server_close()
    thread.join(timeout=2)


def request_json(port: int, path: str) -> tuple[int, dict[str, object]]:
    connection = HTTPConnection("127.0.0.1", port, timeout=2)
    try:
        connection.request("GET", path)
        response = connection.getresponse()
        payload: object = json.loads(response.read())
        assert isinstance(payload, dict)
        return response.status, cast(dict[str, object], payload)
    finally:
        connection.close()


def test_liveness_does_not_require_database(health_server_port: int) -> None:
    status, payload = request_json(health_server_port, "/health/live")

    assert status == 200
    assert payload["status"] == "ok"
    assert payload["service"] == "predictor-test"


@pytest.mark.parametrize(
    ("database_is_ready", "expected_status", "expected_payload_status"),
    [(True, 200, "ok"), (False, 503, "unavailable")],
)
def test_readiness_reflects_database_state(
    health_server_port: int,
    monkeypatch: pytest.MonkeyPatch,
    database_is_ready: bool,
    expected_status: int,
    expected_payload_status: str,
) -> None:
    monkeypatch.setattr(server_module, "database_ready", lambda _url: database_is_ready)

    status, payload = request_json(health_server_port, "/health/ready")

    assert status == expected_status
    assert payload["status"] == expected_payload_status


def test_unknown_path_returns_not_found(health_server_port: int) -> None:
    status, payload = request_json(health_server_port, "/unknown")

    assert status == 404
    assert payload == {"error": "not found"}
