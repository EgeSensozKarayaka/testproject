import pytest

from site_monitor_predictor.config import load_settings


def test_load_settings_uses_safe_defaults() -> None:
    settings = load_settings({"DATABASE_URL": "postgresql://user:pass@postgres/database"})

    assert settings.host == "0.0.0.0"
    assert settings.port == 8000
    assert settings.service_name == "predictor"


def test_load_settings_rejects_non_postgresql_urls() -> None:
    with pytest.raises(ValueError, match="postgres"):
        load_settings({"DATABASE_URL": "https://example.com"})


@pytest.mark.parametrize("port", ["0", "65536"])
def test_load_settings_rejects_out_of_range_ports(port: str) -> None:
    with pytest.raises(ValueError, match="PORT"):
        load_settings(
            {
                "DATABASE_URL": "postgresql://user:pass@postgres/database",
                "PORT": port,
            }
        )
