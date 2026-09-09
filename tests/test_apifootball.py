"""Tests du connecteur API-Football, en particulier de sa robustesse.

Aucun appel réseau : le client httpx est remplacé par un bouchon. Ces tests
existent parce que `/status` a fait tomber le site sur Render avec
`KeyError: 0` — `data[0]` sur un dictionnaire cherche la clé `0`.
"""

from __future__ import annotations

import pytest

from app.providers.apifootball import (
    APIFootballError,
    APIFootballProvider,
    _first_dict,
)


# ---------------------------------------------------------------------------
# Bouchon réseau
# ---------------------------------------------------------------------------
class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text

    def json(self):
        if self._payload is None:
            raise ValueError("pas de JSON")
        return self._payload


class FakeClient:
    """Remplace httpx.Client : renvoie des réponses préparées à l'avance."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def get(self, path, params=None):
        self.calls.append((path, params))
        if not self.responses:
            raise AssertionError(f"appel non prévu sur {path}")
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def close(self):
        pass


def make_provider(responses) -> APIFootballProvider:
    prov = APIFootballProvider.__new__(APIFootballProvider)
    prov.key = "cle-de-test"
    prov.host = "v3.football.api-sports.io"
    prov._last_call = 0.0
    prov._last_team_stats = None
    prov._cache = {}
    prov._client = FakeClient(responses)
    # On neutralise le throttle pour que les tests restent rapides.
    prov._throttle = lambda: None
    return prov


# ---------------------------------------------------------------------------
# _first_dict : normalisation des formes de réponse
# ---------------------------------------------------------------------------
def test_first_dict_accepts_the_nominal_list_shape():
    payload = {"account": {"firstname": "Ada"}, "requests": {"current": 3}}
    assert _first_dict([payload]) is payload


def test_first_dict_accepts_a_bare_object():
    payload = {"account": {"firstname": "Ada"}}
    assert _first_dict(payload) is payload


def test_first_dict_returns_none_on_unusable_shapes():
    for bad in ([], None, "", ["une chaîne"], [1, 2, 3], 0, [None]):
        assert _first_dict(bad) is None, f"_first_dict({bad!r}) devrait être None"


def test_first_dict_skips_non_dict_items_before_finding_one():
    good = {"account": {}}
    assert _first_dict(["texte", 42, None, good]) is good


# ---------------------------------------------------------------------------
# health_check : c'est ici que le KeyError: 0 se produisait
# ---------------------------------------------------------------------------
def test_health_check_survives_a_dict_response():
    """Cas exact du bug Render : `response` est un dict, pas une liste."""
    prov = make_provider([FakeResponse(200, {"response": {"account": {"firstname": "Ada"}}})])
    ok, msg = prov.health_check()
    assert ok is True
    assert "Ada" in msg


def test_health_check_survives_a_string_response():
    prov = make_provider([FakeResponse(200, {"response": "ok"})])
    ok, msg = prov.health_check()
    assert ok is True
    assert "ne renvoie pas" in msg


def test_health_check_survives_a_list_of_strings():
    prov = make_provider([FakeResponse(200, {"response": ["rien", "d'utile"]})])
    ok, _ = prov.health_check()
    assert ok is True


def test_health_check_survives_an_empty_response():
    prov = make_provider([FakeResponse(200, {"response": []})])
    ok, _ = prov.health_check()
    assert ok is True


def test_health_check_survives_a_null_response():
    prov = make_provider([FakeResponse(200, {"response": None})])
    ok, _ = prov.health_check()
    assert ok is True


def test_health_check_never_raises():
    """Quelle que soit la réponse, health_check doit retourner un tuple."""
    payloads = [
        {"response": {}}, {"response": []}, {"response": None},
        {"response": "texte"}, {"response": [1, 2]}, {"response": [{"account": None}]},
        {"response": [{"account": "pas-un-dict"}]},
    ]
    for payload in payloads:
        prov = make_provider([FakeResponse(200, payload)])
        result = prov.health_check()
        assert isinstance(result, tuple) and len(result) == 2, f"échec sur {payload}"
        assert isinstance(result[1], str)


# ---------------------------------------------------------------------------
# health_check : les messages doivent être exploitables
# ---------------------------------------------------------------------------
def test_health_check_reports_account_and_quota():
    prov = make_provider([FakeResponse(200, {
        "response": [{
            "account": {"firstname": "Ada", "lastname": "L", "subscription": "Free"},
            "requests": {"current": 42, "limit_day": 100},
        }]
    })])
    ok, msg = prov.health_check()
    assert ok is True
    assert "clé valide" in msg
    assert "Free" in msg
    assert "42/100" in msg


def test_health_check_flags_an_exhausted_quota_as_unhealthy():
    prov = make_provider([FakeResponse(200, {
        "response": [{
            "account": {"firstname": "Ada", "subscription": "Free"},
            "requests": {"current": 100, "limit_day": 100},
        }]
    })])
    ok, msg = prov.health_check()
    assert ok is False
    assert "quota" in msg.lower()


def test_health_check_reports_a_rejected_key():
    """403 = clé refusée : le message doit pointer vers la configuration."""
    prov = make_provider([FakeResponse(403, None, text="Forbidden")])
    ok, msg = prov.health_check()
    assert ok is False
    assert "clé refusée" in msg
    assert "API_FOOTBALL_KEY" in msg


def test_health_check_reports_an_exhausted_quota_from_http():
    prov = make_provider([FakeResponse(429, None, text="Too Many Requests")])
    ok, msg = prov.health_check()
    assert ok is False
    assert "Quota" in msg or "quota" in msg


def test_health_check_reports_api_level_errors():
    prov = make_provider([FakeResponse(200, {
        "errors": {"token": "Invalid API key"}, "response": []
    })])
    ok, msg = prov.health_check()
    assert ok is False
    assert "Invalid API key" in msg


def test_health_check_reports_network_failures_without_raising():
    prov = make_provider([RuntimeError("DNS résolu nulle part")])
    ok, msg = prov.health_check()
    assert ok is False
    assert "injoignable" in msg


def test_health_check_reports_non_json_responses():
    class Broken(FakeResponse):
        def json(self):
            raise ValueError("HTML au lieu de JSON")

    prov = make_provider([Broken(200)])
    ok, msg = prov.health_check()
    assert ok is False
    assert "non-JSON" in msg


# ---------------------------------------------------------------------------
# get() : propagation correcte des erreurs
# ---------------------------------------------------------------------------
def test_get_raises_on_missing_key():
    prov = make_provider([FakeResponse(403, None, text="Missing key")])
    with pytest.raises(APIFootballError, match="clé refusée"):
        prov.get("/fixtures")


def test_get_caches_successful_calls():
    """Le cache évite de consommer le quota deux fois pour la même requête."""
    prov = make_provider([FakeResponse(200, {"response": [{"id": 1}]})])
    first = prov.get("/fixtures", league=39)
    second = prov.get("/fixtures", league=39)
    assert first == second
    assert len(prov._client.calls) == 1, "le second appel aurait dû être servi par le cache"


def test_get_returns_the_response_list():
    rows = [{"fixture": {"id": 5}}]
    prov = make_provider([FakeResponse(200, {"response": rows})])
    assert prov.get("/fixtures") == rows


# ---------------------------------------------------------------------------
# Choix de la saison (le plan gratuit est limité à 2022-2024)
# ---------------------------------------------------------------------------
def test_season_uses_the_configured_override(monkeypatch):
    """API_FOOTBALL_SEASON doit primer sur la saison courante."""
    from app.providers import apifootball as af

    monkeypatch.setattr(af, "API_FOOTBALL_SEASON", 2023)
    assert af._season() == 2023


def test_season_falls_back_to_current_when_unset(monkeypatch):
    """Sans override, on retombe sur la saison courante (année n si mois >= 7)."""
    from datetime import datetime, timezone

    from app.providers import apifootball as af

    monkeypatch.setattr(af, "API_FOOTBALL_SEASON", None)

    class FakeDateTime(datetime):
        _fixed = None

        @classmethod
        def now(cls, tz=None):
            return cls._fixed

    FakeDateTime._fixed = datetime(2026, 9, 9, tzinfo=timezone.utc)
    monkeypatch.setattr(af, "datetime", FakeDateTime)
    assert af._season() == 2026

    FakeDateTime._fixed = datetime(2026, 3, 15, tzinfo=timezone.utc)
    assert af._season() == 2025, "avant juillet, la saison en cours est l'année précédente"


def test_plan_error_is_translated_into_an_actionable_message():
    """L'erreur 'Free plans do not have access to this season' doit être explicite."""
    prov = make_provider([FakeResponse(200, {
        "errors": {"plan": "Free plans do not have access to this season, try from 2022 to 2024."},
        "response": [],
    })])
    ok, msg = prov.health_check()
    assert ok is False
    assert "API_FOOTBALL_SEASON" in msg, "le message doit dire quoi régler"
    assert "2023" in msg, "le message doit proposer une saison utilisable"
    assert "plan gratuit" in msg


def test_plan_error_mentions_the_free_season_range():
    prov = make_provider([FakeResponse(200, {
        "errors": {"plan": "Free plans do not have access to this season."},
        "response": [],
    })])
    _, msg = prov.health_check()
    for saison in (2022, 2023, 2024):
        assert str(saison) in msg


def test_list_seasons_normalises_the_response():
    rows = [
        {"season": 2023, "start": "2023-08-11", "end": "2024-05-19", "current": False},
        {"season": 2026, "start": "2026-08-15", "end": "2027-05-23", "current": True},
    ]
    prov = make_provider([FakeResponse(200, {"response": rows})])
    got = prov.list_seasons(39)
    assert len(got) == 2
    assert got[1]["current"] is True
    assert got[0]["season"] == 2023


def test_list_seasons_tolerates_junk_entries():
    prov = make_provider([FakeResponse(200, {"response": ["texte", None, {"season": 2023}]})])
    got = prov.list_seasons(39)
    assert len(got) == 1
    assert got[0]["season"] == 2023
