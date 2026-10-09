from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str
    host: str
    port: int
    service_name: str
    version: str


def load_settings(environment: dict[str, str] | None = None) -> Settings:
    values = os.environ if environment is None else environment
    database_url = values.get("DATABASE_URL")
    if not database_url or not database_url.startswith(("postgres://", "postgresql://")):
        raise ValueError("DATABASE_URL must use the postgres or postgresql scheme")

    port = int(values.get("PORT", "8000"))
    if not 1 <= port <= 65_535:
        raise ValueError("PORT must be between 1 and 65535")

    return Settings(
        database_url=database_url,
        host=values.get("HOST", "0.0.0.0"),
        port=port,
        service_name=values.get("SERVICE_NAME", "predictor"),
        version=values.get("SERVICE_VERSION", "0.1.0"),
    )
