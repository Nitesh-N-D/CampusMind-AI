"""Production refuses to start with a missing or well-known SECRET_KEY;
development and tests keep working with the built-in default."""
import os
import subprocess
import sys

import pytest

from app.core import config
from app.core.config import ConfigurationError, Settings, validate_production_settings

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GOOD_KEY = "k" * 16 + "Z9" * 16  # 48 chars, not a known placeholder


@pytest.fixture(autouse=True)
def _no_ambient_config(monkeypatch):
    # Settings reads the process environment too; start from a clean slate.
    monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)


def make(**values) -> Settings:
    return Settings(_env_file=None, **values)


def test_production_without_secret_key_fails():
    with pytest.raises(ConfigurationError, match="SECRET_KEY"):
        validate_production_settings(make(environment="production"))


@pytest.mark.parametrize(
    "value",
    [config.DEFAULT_SECRET_KEY, "change-this-to-a-long-random-string", "secret", "changeme", "", "   "],
)
def test_production_with_placeholder_secret_key_fails(value):
    with pytest.raises(ConfigurationError):
        validate_production_settings(make(environment="production", secret_key=value))


def test_production_with_short_secret_key_fails():
    with pytest.raises(ConfigurationError, match="too short"):
        validate_production_settings(make(environment="production", secret_key="a1b2c3"))


def test_production_with_real_secret_key_passes():
    validate_production_settings(make(environment="production", secret_key=GOOD_KEY))
    validate_production_settings(make(environment=" Production ", secret_key=GOOD_KEY))


@pytest.mark.parametrize("environment", ["development", "test", "staging"])
def test_non_production_keeps_working_with_the_default(environment):
    validate_production_settings(make(environment=environment))
    validate_production_settings(make(environment=environment, secret_key="change-this-to-a-long-random-string"))


def test_error_message_never_contains_the_key():
    secret = "short-but-secret-9"
    with pytest.raises(ConfigurationError) as exc:
        validate_production_settings(make(environment="production", secret_key=secret))
    assert secret not in str(exc.value)


def _import_config(tmp_path, **env):
    """Imports app.core.config in a fresh interpreter from an empty directory, so
    no local .env can leak in."""
    clean = {k: v for k, v in os.environ.items() if k not in ("SECRET_KEY", "ENVIRONMENT")}
    clean.update(env, PYTHONPATH=BACKEND)
    return subprocess.run(
        [sys.executable, "-c", "import app.core.config"], cwd=tmp_path, env=clean, capture_output=True, text=True
    )


def test_app_import_fails_fast_in_production_without_key(tmp_path):
    result = _import_config(tmp_path, ENVIRONMENT="production")
    assert result.returncode != 0
    assert "ConfigurationError" in result.stderr and "SECRET_KEY" in result.stderr
    assert config.DEFAULT_SECRET_KEY not in result.stderr + result.stdout


def test_app_import_succeeds_in_production_with_key_and_in_development(tmp_path):
    assert _import_config(tmp_path, ENVIRONMENT="production", SECRET_KEY=GOOD_KEY).returncode == 0
    assert _import_config(tmp_path, ENVIRONMENT="development").returncode == 0
    assert _import_config(tmp_path).returncode == 0


def test_jwt_signing_still_uses_the_configured_key():
    from app.core.security import create_access_token, decode_token

    assert decode_token(create_access_token({"sub": "1"}))["sub"] == "1"


def test_offline_fallbacks_names_keyless_ai_features_without_values():
    from app.core.config import offline_fallbacks

    assert offline_fallbacks(make(ai_provider="gemini", embedding_provider="gemini", gemini_api_key="")) == ["answers", "embeddings"]
    assert offline_fallbacks(make(ai_provider="gemini", embedding_provider="local", gemini_api_key="x")) == []
    assert offline_fallbacks(make(ai_provider="mock", embedding_provider="local")) == []
