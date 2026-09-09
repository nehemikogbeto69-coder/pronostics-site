"""Tests de la saisie manuelle de matchs.

Le point central : un match saisi doit produire exactement le même pronostic
qu'un match issu de l'API, puisque les deux passent par le même moteur.
"""

from __future__ import annotations

import pytest

from app import db, manual
from app.models import football
from app.sync import sync_all


def base_payload(**over) -> dict:
    p = {
        "home_name": "Équipe Alpha",
        "away_name": "Équipe Beta",
        "kickoff_utc": "2026-10-25T19:00",
        "league_id": 39,
        "round": "Journée 10",
        "venue": "Stade Alpha",
        "home_gf_home": 12, "home_ga_home": 5, "home_n_home": 6,
        "home_gf_away": 8, "home_ga_away": 7, "home_n_away": 6,
        "away_gf_home": 10, "away_ga_home": 8, "away_n_home": 6,
        "away_gf_away": 6, "away_ga_away": 11, "away_n_away": 6,
    }
    p.update(over)
    return p


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("patch,fragment", [
    ({"home_name": ""}, "domicile est obligatoire"),
    ({"home_name": "   "}, "domicile est obligatoire"),
    ({"away_name": ""}, "extérieur est obligatoire"),
    ({"away_name": "équipe alpha"}, "doivent être différentes"),
    ({"kickoff_utc": None}, "date et l'heure"),
    ({"kickoff_utc": "le 25 octobre"}, "Date illisible"),
    ({"league_id": 9999}, "Ligue inconnue"),
    ({"home_n_home": 0}, "au moins 1 match"),
    ({"away_n_away": -3}, "négatif"),
    ({"home_gf_home": -2}, "négatif"),
    ({"away_ga_away": "beaucoup"}, "invalide"),
])
def test_invalid_payloads_are_rejected_with_a_clear_message(patch, fragment):
    with pytest.raises(manual.ManualMatchError, match=fragment):
        manual.validate_payload(base_payload(**patch))


def test_implausible_goal_totals_are_rejected():
    """Un total de buts doit rester crédible par rapport au nombre de matchs."""
    with pytest.raises(manual.ManualMatchError, match="invraisemblable"):
        manual.validate_payload(base_payload(home_gf_home=900, home_n_home=5))


def test_valid_payload_is_accepted_and_normalised():
    clean = manual.validate_payload(base_payload())
    assert clean["home_name"] == "Équipe Alpha"
    assert clean["kickoff_utc"].startswith("2026-10-25T19:00")
    assert clean["home"]["n_home"] == 6


@pytest.mark.parametrize("raw,expected", [
    ("2026-10-25T19:00", "2026-10-25T19:00"),
    ("2026-10-25T19:00Z", "2026-10-25T19:00"),
    ("2026-10-25 19:00", "2026-10-25T19:00"),
])
def test_kickoff_accepts_common_formats(raw, expected):
    clean = manual.validate_payload(base_payload(kickoff_utc=raw))
    assert clean["kickoff_utc"].startswith(expected)


def test_decimal_goal_totals_are_allowed():
    """On peut saisir une moyenne sous forme décimale avec n=1."""
    clean = manual.validate_payload(base_payload(home_gf_home=2.5, home_n_home=1))
    assert clean["home"]["gf_home"] == 2.5


# ---------------------------------------------------------------------------
# Identifiants
# ---------------------------------------------------------------------------
def test_manual_ids_are_negative():
    """Les identifiants négatifs évitent toute collision avec l'API."""
    assert manual.manual_team_id("Une équipe") < 0
    fid = manual.manual_fixture_id("A", "B", "2026-10-25T19:00")
    assert fid < 0


def test_team_id_is_stable_across_case_and_spacing():
    a = manual.manual_team_id("Olympique de Marseille")
    b = manual.manual_team_id("  olympique   DE marseille ")
    assert a == b, "la même équipe saisie deux fois ne doit pas créer de doublon"


def test_team_id_differs_per_name():
    assert manual.manual_team_id("Alpha") != manual.manual_team_id("Beta")


def test_team_id_differs_per_sport():
    assert manual.manual_team_id("Alpha", "football") != manual.manual_team_id("Alpha", "basket")


# ---------------------------------------------------------------------------
# Le point central : même moteur que l'API
# ---------------------------------------------------------------------------
def test_manual_prediction_matches_a_direct_engine_call():
    """Un match saisi doit donner bit à bit le même résultat qu'un appel direct."""
    clean = manual.validate_payload(base_payload())
    pred, conf, detail = manual.compute_prediction(clean)

    baseline = manual._baseline_for(39)
    home = football.compute_strength(
        12, 5, 6, 8, 7, 6, baseline,
    )
    away = football.compute_strength(
        10, 8, 6, 6, 11, 6, baseline,
    )
    direct = football.predict_match(home, away, baseline)

    assert pred.lam_home == direct.lam_home
    assert pred.lam_away == direct.lam_away
    assert pred.p_home == direct.p_home
    assert pred.p_draw == direct.p_draw
    assert pred.p_away == direct.p_away
    assert pred.pick == direct.pick
    assert pred.top_score == direct.top_score


def test_manual_prediction_probabilities_are_coherent():
    pred, conf, _ = manual.compute_prediction(manual.validate_payload(base_payload()))
    # Les valeurs stockées sont arrondies à 4 décimales : tolérance en conséquence.
    assert pred.p_home + pred.p_draw + pred.p_away == pytest.approx(1.0, abs=5e-4)
    assert 0.0 <= conf <= 100.0
    assert pred.matrix is not None
    assert pred.matrix.sum() == pytest.approx(1.0, abs=1e-9)


def test_manual_detail_marks_unavailable_data_explicitly():
    """Forme, H2H et blessés n'existent pas pour une saisie : il faut le dire."""
    _, _, detail = manual.compute_prediction(manual.validate_payload(base_payload()))
    assert detail["source"] == "manual"
    assert detail["form_home"] is None
    assert detail["form_away"] is None
    assert detail["h2h"] is None
    assert detail["injuries"] == []
    # Mais les forces et la référence de ligue, elles, sont bien renseignées.
    assert detail["strength_home"]["attack"] > 0
    assert detail["baseline"]["home_avg_goals"] > 0


# ---------------------------------------------------------------------------
# Écriture en base et cohabitation avec le sync
# ---------------------------------------------------------------------------
def test_created_match_is_tagged_manual():
    created = manual.create_manual_match(base_payload())
    row = db.query_one("SELECT * FROM fixtures WHERE id = ?", (created["fixture_id"],))
    assert row["source"] == "manual"
    assert row["status"] == "NS"
    assert row["home_goals"] is None


def test_created_match_gets_a_prediction():
    created = manual.create_manual_match(base_payload())
    pred = db.query_one(
        "SELECT * FROM predictions WHERE fixture_id = ?", (created["fixture_id"],)
    )
    assert pred is not None
    assert pred["sport"] == "football"
    assert pred["pick"] in ("1", "X", "2")
    assert pred["score_matrix"] is not None
    assert 0 <= pred["confidence"] <= 100


def test_created_teams_get_stats_so_the_detail_view_works():
    created = manual.create_manual_match(base_payload())
    for tid in (created["home_id"], created["away_id"]):
        st = db.query_one("SELECT * FROM team_stats WHERE team_id = ?", (tid,))
        assert st is not None, "sans team_stats, l'écran de détail serait vide"
        assert st["played"] == 12
        assert st["played_home"] == 6 and st["played_away"] == 6


def test_manual_stats_do_not_pollute_the_standings():
    """Les équipes saisies ne disputent pas le championnat suivi."""
    created = manual.create_manual_match(base_payload())
    manual._store_team_stats  # existe
    st = db.query_one(
        "SELECT * FROM team_stats WHERE team_id = ?", (created["home_id"],)
    )
    assert st["points"] == 0, "on ne doit pas inventer de points"
    assert st["position"] == 0, "ni de place au classement"


def test_duplicate_match_is_rejected():
    manual.create_manual_match(base_payload())
    with pytest.raises(manual.ManualMatchError, match="existe déjà"):
        manual.create_manual_match(base_payload())


def test_same_teams_at_another_time_is_allowed():
    manual.create_manual_match(base_payload())
    other = manual.create_manual_match(base_payload(kickoff_utc="2026-11-25T19:00"))
    assert other["fixture_id"] < 0


def test_survives_an_automatic_sync():
    """Le sync ne doit jamais écraser ni supprimer une saisie manuelle."""
    sync_all(days_ahead=7)
    created = manual.create_manual_match(base_payload())
    fid = created["fixture_id"]

    before = db.query_one("SELECT lambda_home FROM predictions WHERE fixture_id = ?", (fid,))
    n_manual_before = db.query_one(
        "SELECT COUNT(*) n FROM fixtures WHERE source = 'manual'"
    )["n"]
    n_auto_before = db.query_one(
        "SELECT COUNT(*) n FROM fixtures WHERE source != 'manual'"
    )["n"]

    result = sync_all(days_ahead=7)

    n_manual_after = db.query_one(
        "SELECT COUNT(*) n FROM fixtures WHERE source = 'manual'"
    )["n"]
    n_auto_after = db.query_one(
        "SELECT COUNT(*) n FROM fixtures WHERE source != 'manual'"
    )["n"]
    after = db.query_one("SELECT lambda_home FROM predictions WHERE fixture_id = ?", (fid,))

    assert n_manual_after == n_manual_before, "le match saisi a disparu au sync"
    assert n_auto_after >= n_auto_before, "le sync a perdu des matchs automatiques"
    assert after is not None, "le pronostic du match saisi a disparu"
    assert result.get("manual_recomputed") == 1


def test_recompute_keeps_the_user_statistics():
    """Recalculer ne doit pas modifier les statistiques saisies."""
    created = manual.create_manual_match(base_payload())
    fid = created["fixture_id"]
    before = db.query_one("SELECT * FROM manual_matches WHERE fixture_id = ?", (fid,))

    assert manual.recompute_manual_match(fid) is True

    after = db.query_one("SELECT * FROM manual_matches WHERE fixture_id = ?", (fid,))
    for col in ("home_gf_home", "home_ga_home", "home_gf_away", "home_ga_away",
                "away_gf_home", "away_ga_home", "away_gf_away", "away_ga_away",
                "home_n_home", "home_n_away", "away_n_home", "away_n_away"):
        assert before[col] == after[col], f"{col} a été modifié par le recalcul"


def test_recompute_unknown_match_returns_false():
    assert manual.recompute_manual_match(-999999) is False


def test_delete_removes_everything_related():
    created = manual.create_manual_match(base_payload())
    fid = created["fixture_id"]
    assert manual.delete_manual_match(fid) is True

    assert db.query_one("SELECT 1 FROM fixtures WHERE id = ?", (fid,)) is None
    assert db.query_one("SELECT 1 FROM predictions WHERE fixture_id = ?", (fid,)) is None
    assert db.query_one("SELECT 1 FROM manual_matches WHERE fixture_id = ?", (fid,)) is None


def test_delete_unknown_match_returns_false():
    assert manual.delete_manual_match(-999999) is False


def test_delete_does_not_touch_automatic_matches():
    sync_all(days_ahead=7)
    auto = db.query_one("SELECT id FROM fixtures WHERE source != 'manual' LIMIT 1")
    assert auto is not None
    assert manual.delete_manual_match(auto["id"]) is False
    assert db.query_one("SELECT 1 FROM fixtures WHERE id = ?", (auto["id"],)) is not None


# ---------------------------------------------------------------------------
# Référence de ligue
# ---------------------------------------------------------------------------
def test_baseline_falls_back_to_config_when_the_league_table_is_empty():
    baseline = manual._baseline_for(39)
    assert baseline.home_avg_goals > 0
    assert baseline.away_avg_goals > 0
    assert baseline.home_advantage > 1.0


def test_baseline_prefers_observed_league_averages():
    """Si le sync a mesuré les moyennes réelles, ce sont elles qui priment."""
    sync_all(days_ahead=7)
    observed = db.query_one("SELECT * FROM leagues WHERE id = 39")
    assert observed["home_avg_goals"] is not None

    baseline = manual._baseline_for(39)
    assert baseline.home_avg_goals == pytest.approx(float(observed["home_avg_goals"]))
    assert baseline.away_avg_goals == pytest.approx(float(observed["away_avg_goals"]))
