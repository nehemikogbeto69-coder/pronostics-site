"""Tests des moteurs de pronostic.

Ces tests valident la justesse mathématique, pas seulement l'absence d'erreur.
"""

from __future__ import annotations

import math

import pytest
from scipy import stats as sp_stats

from app.models import basketball, confidence, football, tennis


# ---------------------------------------------------------------------------
# Poisson : cohérence avec scipy
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("lam", [0.3, 0.8, 1.5, 2.4, 3.7])
def test_poisson_pmf_matches_scipy(lam):
    """Notre PMF manuelle doit coller à scipy.stats.poisson.pmf."""
    for k in range(12):
        assert football.poisson_pmf(k, lam) == pytest.approx(
            float(sp_stats.poisson.pmf(k, lam)), abs=1e-12
        )


def test_poisson_pmf_sums_to_one():
    for lam in (0.5, 1.2, 2.0, 3.3):
        total = sum(football.poisson_pmf(k, lam) for k in range(40))
        assert total == pytest.approx(1.0, abs=1e-9)


# ---------------------------------------------------------------------------
# Matrice des scores
# ---------------------------------------------------------------------------
def test_score_matrix_is_a_probability_distribution():
    m = football.score_matrix(1.7, 1.2)
    assert m.sum() == pytest.approx(1.0, abs=1e-9)
    assert (m >= 0).all()


def test_score_matrix_expected_goals_match_lambdas():
    """La moyenne de la grille doit retrouver les lambdas injectés."""
    lam_h, lam_a = 1.8, 1.1
    m = football.score_matrix(lam_h, lam_a, max_goals=15)
    n = m.shape[0]
    idx = range(n)
    mean_home = sum(i * m[i].sum() for i in idx)
    mean_away = sum(j * m[:, j].sum() for j in idx)
    # La troncature à 15 buts fait perdre un peu de masse : tolérance large.
    assert mean_home == pytest.approx(lam_h, abs=0.02)
    assert mean_away == pytest.approx(lam_a, abs=0.02)


def test_dixon_coles_boosts_draws_at_zero():
    """Sans correction, le 0-0 est sous-estimé ; DC doit l'augmenter."""
    lam, mu, rho = 1.4, 1.1, -0.08
    plain = football.poisson_pmf(0, lam) * football.poisson_pmf(0, mu)
    corrected = plain * football.dixon_coles_tau(0, 0, lam, mu, rho)
    assert corrected > plain


# ---------------------------------------------------------------------------
# Buts attendus
# ---------------------------------------------------------------------------
def _baseline():
    return football.LeagueBaseline(home_avg_goals=1.5, away_avg_goals=1.2, home_advantage=1.18)


def test_equal_teams_favour_home_side():
    """À forces égales, l'avantage du terrain doit donner l'avantage au domicile."""
    s = football.TeamStrength(0, 1.0, 1.0, 1.0, 1.0)
    lam_h, lam_a = football.expected_goals(s, s, _baseline())
    assert lam_h > lam_a


def test_stronger_attack_yields_more_goals():
    weak = football.TeamStrength(0, 0.8, 1.1, 0.8, 1.1)
    strong = football.TeamStrength(1, 1.5, 0.8, 1.5, 0.8)
    lam_strong, _ = football.expected_goals(strong, weak, _baseline())
    lam_weak, _ = football.expected_goals(weak, strong, _baseline())
    assert lam_strong > lam_weak


def test_expected_goals_are_clamped():
    extreme = football.TeamStrength(0, 9.0, 0.05, 9.0, 0.05)
    lam_h, lam_a = football.expected_goals(extreme, extreme, _baseline())
    assert 0.1 <= lam_h <= 5.5
    assert 0.08 <= lam_a <= 4.5


def test_strength_smoothing_damps_small_samples():
    """Une équipe à 1 match ne doit pas obtenir une force extrême."""
    baseline = _baseline()
    one_match = football.compute_strength(
        5, 0, 1, 0, 0, 0, baseline, prior_weight=2.0
    )
    ten_matches = football.compute_strength(
        50, 0, 10, 0, 0, 0, baseline, prior_weight=2.0
    )
    assert one_match.attack_home < ten_matches.attack_home
    assert one_match.attack_home < 3.0  # pas de valeur délirante


def test_strength_neutral_team_is_around_one():
    """Une équipe pile dans la moyenne doit avoir une force proche de 1."""
    baseline = _baseline()
    st = football.compute_strength(
        goals_for_home=15, goals_against_home=12, played_home=10,
        goals_for_away=12, goals_against_away=15, played_away=10,
        baseline=baseline,
    )
    assert st.attack == pytest.approx(1.0, abs=0.02)
    assert st.defence == pytest.approx(1.0, abs=0.02)


# ---------------------------------------------------------------------------
# Pronostic football
# ---------------------------------------------------------------------------
def test_prediction_probabilities_sum_to_one():
    a = football.TeamStrength(0, 1.2, 0.9, 1.2, 0.9)
    b = football.TeamStrength(1, 0.9, 1.2, 0.9, 1.2)
    p = football.predict_match(a, b, _baseline())
    assert p.p_home + p.p_draw + p.p_away == pytest.approx(1.0, abs=1e-6)


def test_over_under_are_complementary():
    """Les buts étant entiers et la ligne à 2.5, over + under doit faire exactement 1."""
    a = football.TeamStrength(0, 1.2, 0.9, 1.2, 0.9)
    b = football.TeamStrength(1, 0.9, 1.2, 0.9, 1.2)
    p = football.predict_match(a, b, _baseline())
    for v in (p.over, p.under, p.btts):
        assert 0.0 <= v <= 1.0
    assert p.over + p.under == pytest.approx(1.0, abs=1e-9)
    assert p.over > 0.0


def test_stronger_team_is_favoured():
    """L'équipe la plus forte doit avoir plus de chances de gagner que l'autre.

    Attention : même très déséquilibré, un match de football garde le match nul
    comme issue UNIQUE la plus fréquente (0-0, 1-1, 2-2 s'accumulent là où les
    victoires se dispersent sur tous les scores). Le test porte donc sur la
    comparaison 1 contre 2, pas sur la valeur maximale absolue.
    """
    strong = football.TeamStrength(0, 1.5, 0.75, 1.5, 0.75)
    weak = football.TeamStrength(1, 0.75, 1.4, 0.75, 1.4)
    p = football.predict_match(strong, weak, _baseline())
    assert p.p_home > p.p_away
    # Probabilité que le favori ne perde pas (1X), bien plus parlante que le pick brut.
    assert p.p_home + p.p_draw > 0.5


def _strength_from_lambdas(lam_h: float, lam_a: float, baseline) -> tuple:
    """Construit des forces qui produisent exactement les lambdas voulus.

    On résout à l'envers :
        lam_h = att_h * def_a * moy_dom * avantage
        lam_a = att_a * def_h * moy_ext
    Sans ça, on devine des forces et on obtient des lambdas inattendus.
    """
    att_h = 1.2
    def_a = lam_h / (att_h * baseline.home_avg_goals * baseline.home_advantage)
    att_a = 1.2
    def_h = lam_a / (att_a * baseline.away_avg_goals)
    home = football.TeamStrength(0, att_h, def_h, att_h, def_h)
    away = football.TeamStrength(1, att_a, def_a, att_a, def_a)
    return home, away


def test_draw_is_modal_only_in_low_scoring_games():
    """Le nul n'est l'issue UNIQUE la plus probable que sur les petits scores.

    Propriété du Poisson bivarié : les nuls (0-0, 1-1, 2-2...) s'accumulent sur
    la diagonale tandis que les victoires se dispersent sur toute une moitié de
    la matrice. Le balayage montre que le phénomène ne survient qu'en dessous
    d'environ 0.9 but attendu par équipe — soit des matchs très fermés.
    """
    baseline = _baseline()
    home, away = _strength_from_lambdas(0.80, 0.60, baseline)
    lam_h, lam_a = football.expected_goals(home, away, baseline)
    assert lam_h == pytest.approx(0.80, abs=0.01)
    assert lam_a == pytest.approx(0.60, abs=0.01)

    p = football.predict_match(home, away, baseline)
    assert p.p_draw > p.p_home, "sur un match fermé le nul doit dominer"
    assert p.p_draw > p.p_away
    assert p.pick == "X"


def test_extreme_mismatch_favourite_is_modal():
    """À l'inverse, avec un écart énorme, la victoire du favori redevient modale."""
    baseline = _baseline()
    home, away = _strength_from_lambdas(4.00, 0.40, baseline)
    p = football.predict_match(home, away, baseline)
    assert p.p_home > 0.9
    assert p.p_home > p.p_draw
    assert p.pick == "1"


def test_pick_never_defaults_to_draw_lexicographically():
    """Non-régression : `max()` sur tuples compare les chaînes d'abord.

    Comme "1" < "2" < "X" en ordre lexicographique, un `max()` sans `key=`
    renvoyait "X" sur TOUS les matchs, y compris à p_home = 0,99.
    """
    baseline = _baseline()
    home, away = _strength_from_lambdas(3.50, 0.50, baseline)
    p = football.predict_match(home, away, baseline)
    assert p.p_home > 0.85
    assert p.pick == "1", "le pick doit suivre la probabilité, pas l'ordre alphabétique"
    # Et symétriquement pour une victoire extérieure.
    home2, away2 = _strength_from_lambdas(0.50, 3.00, baseline)
    p2 = football.predict_match(home2, away2, baseline)
    assert p2.pick == "2"


def test_pick_always_equals_argmax():
    """Sur une grille de cas, le pick doit toujours être l'issue maximale."""
    baseline = _baseline()
    for lam_h in (0.6, 1.2, 2.0, 3.0, 4.2):
        for lam_a in (0.4, 1.0, 1.8, 2.6):
            home, away = _strength_from_lambdas(lam_h, lam_a, baseline)
            p = football.predict_match(home, away, baseline)
            expected = max(
                [("1", p.p_home), ("X", p.p_draw), ("2", p.p_away)],
                key=lambda t: t[1],
            )[0]
            assert p.pick == expected, f"lam=({lam_h},{lam_a}) pick={p.pick}"


def test_pick_matches_highest_probability():
    """Le pick doit toujours correspondre à la plus grande des trois probabilités."""
    a = football.TeamStrength(0, 1.15, 0.95, 1.15, 0.95)
    b = football.TeamStrength(1, 0.95, 1.1, 0.95, 1.1)
    p = football.predict_match(a, b, _baseline())
    assert p.pick_prob == max(p.p_home, p.p_draw, p.p_away)


def test_top_score_is_the_matrix_maximum():
    a = football.TeamStrength(0, 1.15, 0.95, 1.15, 0.95)
    b = football.TeamStrength(1, 0.95, 1.1, 0.95, 1.1)
    p = football.predict_match(a, b, _baseline())
    i, j = p.top_score
    assert p.matrix[i, j] == p.matrix.max()
    # top_score_prob est arrondi à 4 décimales dans le dataclass.
    assert p.top_score_prob == pytest.approx(float(p.matrix.max()), abs=5e-5)


def test_implied_odds_are_sane():
    assert football.implied_odds(0.5) == pytest.approx(2.0)
    assert football.implied_odds(0.25) == pytest.approx(4.0)
    assert football.implied_odds(0.0) is None
    # Une marge bookmaker réduit toujours la cote proposée.
    assert football.implied_odds(0.5, margin=0.05) < football.implied_odds(0.5)


def test_log_loss_penalises_wrong_outcome():
    confident = (0.8, 0.1, 0.1)
    right = football.log_loss(confident, (2, 0))
    wrong = football.log_loss(confident, (0, 2))
    assert wrong > right > 0


def test_brier_perfect_prediction_is_zero():
    assert football.brier_1x2((1.0, 0.0, 0.0), (3, 0)) == pytest.approx(0.0)
    assert football.brier_1x2((0.0, 0.0, 1.0), (3, 0)) == pytest.approx(2.0)


# ---------------------------------------------------------------------------
# Indice de confiance
# ---------------------------------------------------------------------------
def test_confidence_orders_cases_correctly():
    clear = confidence.confidence([0.75, 0.15, 0.10])
    medium = confidence.confidence([0.45, 0.30, 0.25])
    coin_flip = confidence.confidence([0.34, 0.33, 0.33])
    assert clear > medium > coin_flip


def test_confidence_is_bounded():
    for probs in ([1.0, 0.0, 0.0], [0.34, 0.33, 0.33], [0.5, 0.5, 0.0]):
        c = confidence.confidence(probs)
        assert 0.0 <= c <= 100.0


def test_entropy_extremes():
    assert confidence.shannon_entropy([1.0, 0.0, 0.0]) == pytest.approx(0.0)
    assert confidence.shannon_entropy([1 / 3, 1 / 3, 1 / 3]) == pytest.approx(1.0)


def test_confidence_label_thresholds():
    assert confidence.confidence_label(80) == "Élevée"
    assert confidence.confidence_label(50) == "Moyenne"
    assert confidence.confidence_label(30) == "Faible"
    assert confidence.confidence_label(10) == "Très faible"


def test_value_edge_sign():
    # Cote généreuse par rapport au modèle -> avantage positif.
    assert confidence.value_edge(0.5, 2.5) > 0
    assert confidence.value_edge(0.5, 1.5) < 0


# ---------------------------------------------------------------------------
# Tennis — Elo
# ---------------------------------------------------------------------------
def test_elo_expected_score_symmetry():
    e_ab = tennis.expected_score(1600, 1400)
    e_ba = tennis.expected_score(1400, 1600)
    assert e_ab + e_ba == pytest.approx(1.0, abs=1e-9)
    assert e_ab > 0.5


def test_tennis_favourite_wins_more_often():
    a = tennis.PlayerRating(1, "Fort", elo=1900)
    b = tennis.PlayerRating(2, "Faible", elo=1500)
    p = tennis.win_probability(a, b, "hard")
    assert p > 0.7


def test_tennis_surface_adjustment_matters():
    a = tennis.PlayerRating(1, "Terre", elo=1700, surface_delta={"clay": 120, "grass": -80, "hard": 0, "indoor": 0})
    b = tennis.PlayerRating(2, "Gazon", elo=1700, surface_delta={"clay": -80, "grass": 120, "hard": 0, "indoor": 0})
    assert tennis.win_probability(a, b, "clay") > 0.5
    assert tennis.win_probability(a, b, "grass") < 0.5


def test_elo_update_conserves_total():
    a = tennis.PlayerRating(1, "A", elo=1600)
    b = tennis.PlayerRating(2, "B", elo=1500)
    na, nb = tennis.update_elo(a, b)
    assert na + nb == pytest.approx(a.elo + b.elo, abs=0.01)
    assert na > a.elo > b.elo > nb


def test_tennis_prediction_is_consistent():
    a = tennis.PlayerRating(1, "A", elo=1800)
    b = tennis.PlayerRating(2, "B", elo=1600)
    p = tennis.predict_match(a, b, "hard")
    assert p["p_home"] + p["p_away"] == pytest.approx(1.0, abs=1e-6)
    assert p["pick"] == "A"
    assert 0 <= p["confidence"] <= 100


def test_sets_probabilities_sum_to_one():
    s = tennis.sets_probability(0.7)
    assert s["p_2_sets"] + s["p_3_sets"] == pytest.approx(1.0, abs=1e-9)


# ---------------------------------------------------------------------------
# Basket
# ---------------------------------------------------------------------------
def test_basket_home_edge_applies():
    ctx = basketball.LeagueContext(avg_points_scored=114.0, avg_pace=100.0, home_edge=2.8)
    identical = basketball.HoopsRating(0, 114, 114, 114, 114)
    exp_h, exp_a = basketball.expected_points(identical, identical, ctx)
    assert exp_h - exp_a == pytest.approx(2.8, abs=0.01)


def test_basket_probabilities_sum_to_one():
    home = basketball.HoopsRating(0, 120, 108, 116, 112)
    away = basketball.HoopsRating(1, 112, 116, 110, 118)
    p = basketball.predict_match(home, away)
    assert p["p_home"] + p["p_away"] == pytest.approx(1.0, abs=1e-9)
    assert 0 <= p["over_25"] <= 1
    assert p["over_25"] + p["under"] == pytest.approx(1.0, abs=1e-9)


def test_basket_stronger_team_favoured():
    strong = basketball.HoopsRating(0, 125, 105, 122, 108)
    weak = basketball.HoopsRating(1, 105, 125, 103, 128)
    p = basketball.predict_match(strong, weak)
    assert p["p_home"] > 0.8
    assert p["pick"] == "1"


def test_basket_pace_inflates_total():
    ctx = basketball.LeagueContext()
    slow = basketball.HoopsRating(0, 114, 114, 114, 114, pace=92)
    fast = basketball.HoopsRating(1, 114, 114, 114, 114, pace=108)
    _, _ = basketball.expected_points(slow, slow, ctx)
    sh, sa = basketball.expected_points(fast, fast, ctx)
    assert sh + sa > 228  # rythme élevé -> total plus haut


# ---------------------------------------------------------------------------
# Cas limites du lissage (trouves par le balayage de prior_weight)
# ---------------------------------------------------------------------------
def test_zero_prior_weight_with_no_away_games_is_neutral():
    """prior_weight=0 et zero match a l'exterieur ne doit pas diviser par zero."""
    baseline = _baseline()
    st = football.compute_strength(
        goals_for_home=5, goals_against_home=2, played_home=2,
        goals_for_away=0, goals_against_away=0, played_away=0,
        baseline=baseline, prior_weight=0.0,
    )
    assert st.attack_away == pytest.approx(1.0)
    assert st.defence_away == pytest.approx(1.0)
    # Le cote domicile, lui, reste calcule sur les vraies donnees.
    assert st.attack_home != pytest.approx(1.0)


def test_zero_prior_weight_with_no_home_games_is_neutral():
    baseline = _baseline()
    st = football.compute_strength(
        goals_for_home=0, goals_against_home=0, played_home=0,
        goals_for_away=4, goals_against_away=6, played_away=3,
        baseline=baseline, prior_weight=0.0,
    )
    assert st.attack_home == pytest.approx(1.0)
    assert st.defence_home == pytest.approx(1.0)
    assert st.attack_away != pytest.approx(1.0)


def test_strength_never_produces_nan_or_inf():
    """Aucune combinaison de parametres ne doit sortir NaN ou infini."""
    baseline = _baseline()
    for pw in (0.0, 0.5, 2.0):
        for ph in (0, 1, 10):
            for pa in (0, 1, 10):
                st = football.compute_strength(
                    ph * 1.4, ph * 1.1, ph, pa * 0.9, pa * 1.3, pa,
                    baseline, prior_weight=pw,
                )
                for v in (st.attack_home, st.defence_home, st.attack_away, st.defence_away):
                    assert math.isfinite(v), f"valeur non finie : pw={pw} ph={ph} pa={pa}"
                assert st.attack > 0 and st.defence > 0


def test_tennis_probabilities_stay_realistic():
    """Non-regression : un multiplicateur de logit trop eleve saturait la logistique.

    Avec sharpness = 5.5, un ecart de +25 points Elo donnait 65 % de chances de
    victoire, alors que l'Elo standard en donne 53,6 %. Sur le circuit reel, un
    ecart de 25 points ne justifie pas un tel desequilibre.
    """
    for delta, ceiling in ((25, 0.60), (50, 0.65), (75, 0.70), (100, 0.75)):
        a = tennis.PlayerRating(1, elo=1500 + delta)
        b = tennis.PlayerRating(2, elo=1500)
        p = tennis.win_probability(a, b, "hard")
        assert p <= ceiling, f"ecart {delta} -> {p:.3f}, plafond {ceiling}"
        assert p > 0.5, f"le mieux classe doit rester favori (ecart {delta})"


def test_tennis_sharpness_one_is_standard_elo():
    """sharpness = 1.0 doit redonner exactement la formule Elo classique."""
    a = tennis.PlayerRating(1, elo=1700)
    b = tennis.PlayerRating(2, elo=1550)
    assert tennis.win_probability(a, b, "hard", sharpness=1.0) == pytest.approx(
        tennis.expected_score(1700, 1550), abs=1e-9
    )


def test_tennis_monotonic_in_rating_gap():
    """Plus l'ecart grandit, plus la probabilite du favori augmente."""
    b = tennis.PlayerRating(2, elo=1500)
    prev = 0.0
    for delta in range(0, 301, 25):
        a = tennis.PlayerRating(1, elo=1500 + delta)
        p = tennis.win_probability(a, b, "hard")
        assert p >= prev, f"non monotone a l'ecart {delta}"
        prev = p
    assert prev < 0.99
