from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal, TypedDict

import psycopg


class HealthPayload(TypedDict):
    service: str
    status: Literal["ok", "unavailable"]
    timestamp: str
    version: str


def health_payload(
    service: str,
    version: str,
    status: Literal["ok", "unavailable"],
) -> HealthPayload:
    return {
        "service": service,
        "status": status,
        "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "version": version,
    }


def database_ready(database_url: str) -> bool:
    try:
        with (
            psycopg.connect(database_url, connect_timeout=2) as connection,
            connection.cursor() as cursor,
        ):
            cursor.execute("SELECT 1")
            cursor.fetchone()
        return True
    except psycopg.Error:
        return False
