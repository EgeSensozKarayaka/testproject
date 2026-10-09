from typing import NoReturn

import psycopg
import pytest

from site_monitor_predictor.health import database_ready, health_payload


def test_health_payload_is_explainable() -> None:
    payload = health_payload("predictor", "0.1.0", "ok")

    assert payload["service"] == "predictor"
    assert payload["status"] == "ok"
    assert payload["timestamp"].endswith("Z")


def test_database_readiness_is_false_when_postgres_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_to_connect(*_args: object, **_kwargs: object) -> NoReturn:
        raise psycopg.OperationalError("database unavailable")

    monkeypatch.setattr(psycopg, "connect", fail_to_connect)

    assert database_ready("postgresql://user:pass@postgres/database") is False
