"""Phase 1 — DEMO_MODE flag + GET /api/config.

The autouse _tmp_data_dir fixture sets DATA_DIR but never DEMO_MODE, so the flag
defaults to off unless a test sets it explicitly.
"""

import pytest

import constants
from constants import APP_VERSION, is_demo_mode


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "Yes", "on", " on "])
def test_is_demo_mode_truthy_values(monkeypatch, value):
    monkeypatch.setenv("DEMO_MODE", value)
    assert is_demo_mode() is True


def test_is_demo_mode_unset_is_false(monkeypatch):
    monkeypatch.delenv("DEMO_MODE", raising=False)
    assert is_demo_mode() is False


@pytest.mark.parametrize("value", ["", "0", "false", "no", "maybe", "off", "2"])
def test_is_demo_mode_malformed_is_false(monkeypatch, value):
    # A typo must never silently flip a real deployment into a data-discarding
    # demo — anything outside the explicit truthy set is off.
    monkeypatch.setenv("DEMO_MODE", value)
    assert is_demo_mode() is False


def test_config_endpoint_reports_demo_on(client, monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "1")
    res = client.get("/api/config")
    assert res.status_code == 200
    assert res.json() == {"demo_mode": True, "version": APP_VERSION}


def test_config_endpoint_defaults_off(client, monkeypatch):
    monkeypatch.delenv("DEMO_MODE", raising=False)
    res = client.get("/api/config")
    assert res.status_code == 200
    body = res.json()
    assert body["demo_mode"] is False
    assert body["version"] == constants.APP_VERSION


def test_config_endpoint_malformed_value_is_not_an_error(client, monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "maybe")
    res = client.get("/api/config")
    assert res.status_code == 200
    assert res.json()["demo_mode"] is False
