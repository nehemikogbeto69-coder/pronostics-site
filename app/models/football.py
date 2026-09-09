"""Modèle de pronostic football — distribution de Poisson bivariée.

Pipeline :
  1. force d'attaque  = buts marqués de l'équipe  / moyenne de buts marqués de la ligue
  2. force de défense = buts encaissés de l'équipe / moyenne de buts encaissés de la ligue
  3. lambda_home = force_attaque_dom * force_defense_ext * moyenne_dom * avantage_domicile
  4. matrice P(i, j) = Poisson(i; λh) * Poisson(j; λa), corrigée par Dixon-Coles
  5. on somme la matrice par zones pour obtenir 1X2, over/under, BTTS, score exact

Les lambdas sont calculés à partir des moyennes **séparées domicile/extérieur**,
ce qui est plus fidèle que la moyenne globale (l'effet terrain est réel et mesurable).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from ..config import DIXON_COLES_TAU_RHO, MAX_GOALS, OVER_UNDER_LINE, PRIOR_WEIGHT

MODEL_VERSION = "poisson-dc-1.0"


# ---------------------------------------------------------------------------
# Petits utilitaires statistiques
# ---------------------------------------------------------------------------
def poisson_pmf(k: int, lam: float) -> float:
    """P(X = k) pour X ~ Poisson(lam). Stable même pour lam petit."""
    if lam <= 0:
        return 1.0 if k == 0 else 0.0
    return math.exp(-lam + k * math.log(lam) - math.lgamma(k + 1))


def poisson_cdf(k: int, lam: float) -> float:
    return sum(poisson_pmf(i, lam) for i in range(k + 1))


def dixon_coles_tau(i: int, j: int, lam: float, mu: float, rho: float) -> float:
    """Facteur correcteur de Dixon & Coles (1997) pour les petits scores.

    Il corrige la sous-estimation classique des 0-0 et 1-1 par un Poisson
    indépendant pur, et la surestimation des 1-0 / 0-1.
    """
    if i == 0 and j == 0:
        return 1.0 - lam * mu * rho
    if i == 0 and j == 1:
        return 1.0 + lam * rho
    if i == 1 and j == 0:
        return 1.0 + mu * rho
    if i == 1 and j == 1:
        return 1.0 - rho
    return 1.0


# ---------------------------------------------------------------------------
# Force des équipes
# ---------------------------------------------------------------------------
@dataclass
class TeamStrength:
    """Force offensive et défensive d'une équipe, normalisée par la ligue."""

    team_id: int
    attack_home: float
    defence_home: float
    attack_away: float
    defence_away: float

    @property
    def attack(self) -> float:
        return (self.attack_home + self.attack_away) / 2

    @property
    def defence(self) -> float:
        return (self.defence_home + self.defence_away) / 2


@dataclass
class LeagueBaseline:
    home_avg_goals: float
    away_avg_goals: float
    home_advantage: float

    @property
    def avg_scored_home(self) -> float:
        return self.home_avg_goals

    @property
    def avg_scored_away(self) -> float:
        return self.away_avg_goals


def compute_strength(
    goals_for_home: float,
    goals_against_home: float,
    played_home: int,
    goals_for_away: float,
    goals_against_away: float,
    played_away: int,
    baseline: LeagueBaseline,
    team_id: int = 0,
    prior_weight: float = PRIOR_WEIGHT,
) -> TeamStrength:
    """Force attaque/défense normalisée, avec lissage bayésien.

    `prior_weight` matchs fictifs joués à la moyenne de la ligue : évite qu'une
    équipe à 1 ou 2 journées produise des forces extrêmes (1 équipe qui gagne
    5-0 au premier match n'est pas 3x plus forte que la ligue).
    """
    ph = max(played_home, 0)
    pa = max(played_away, 0)
    pw = max(prior_weight, 0.0)

    # Lissage : on ajoute `prior_weight` matchs joués pile à la moyenne.
    # Si une équipe n'a rien joué du tout à domicile (ou à l'extérieur) ET que
    # le lissage est nul, le dénominateur tombe à zéro : on retombe alors sur une
    # force neutre de 1.0, ce qui est la seule hypothèse défendable.
    dh = ph + pw
    da = pa + pw

    if dh > 0:
        fh = (goals_for_home + pw * baseline.home_avg_goals) / dh
        ah = (goals_against_home + pw * baseline.away_avg_goals) / dh
    else:
        fh, ah = baseline.home_avg_goals, baseline.away_avg_goals

    if da > 0:
        fa = (goals_for_away + pw * baseline.away_avg_goals) / da
        aa = (goals_against_away + pw * baseline.home_avg_goals) / da
    else:
        fa, aa = baseline.away_avg_goals, baseline.home_avg_goals

    eps = 1e-9
    return TeamStrength(
        team_id=team_id,
        attack_home=fh / (baseline.home_avg_goals + eps),
        defence_home=ah / (baseline.away_avg_goals + eps),
        attack_away=fa / (baseline.away_avg_goals + eps),
        defence_away=aa / (baseline.home_avg_goals + eps),
    )


# ---------------------------------------------------------------------------
# Buts attendus
# ---------------------------------------------------------------------------
def expected_goals(
    home: TeamStrength,
    away: TeamStrength,
    baseline: LeagueBaseline,
) -> tuple[float, float]:
    """λ domicile et λ extérieur.

    λ_home = attaque_domicile(home) x défense_extérieur(away) x moy_domicile x avantage
    λ_away = attaque_extérieur(away) x défense_domicile(home) x moy_extérieur
    """
    lam_home = (
        home.attack_home
        * away.defence_away
        * baseline.home_avg_goals
        * baseline.home_advantage
    )
    lam_away = away.attack_away * home.defence_home * baseline.away_avg_goals

    # Garde-fous : aucune équipe ne peut raisonnablement viser 8 buts/match.
    lam_home = min(max(lam_home, 0.12), 5.5)
    lam_away = min(max(lam_away, 0.08), 4.5)
    return round(lam_home, 4), round(lam_away, 4)


# ---------------------------------------------------------------------------
# Matrice des scores
# ---------------------------------------------------------------------------
def score_matrix(
    lam_home: float,
    lam_away: float,
    max_goals: int = MAX_GOALS,
    rho: float = DIXON_COLES_TAU_RHO,
) -> np.ndarray:
    """Matrice (max_goals+1, max_goals+1) des probabilités de score exact."""
    ph = np.array([poisson_pmf(i, lam_home) for i in range(max_goals + 1)])
    pa = np.array([poisson_pmf(j, lam_away) for j in range(max_goals + 1)])
    m = np.outer(ph, pa)

    # Correction Dixon-Coles sur le coin 2x2 des petits scores.
    for i in range(min(2, max_goals + 1)):
        for j in range(min(2, max_goals + 1)):
            m[i, j] *= dixon_coles_tau(i, j, lam_home, lam_away, rho)

    m = np.clip(m, 0.0, None)
    total = m.sum()
    if total > 0:  # renormalisation : la correction DC casse légèrement la somme à 1
        m = m / total
    return m


@dataclass
class FootballPrediction:
    lam_home: float
    lam_away: float
    p_home: float
    p_draw: float
    p_away: float
    over: float                      # P(total > ligne)
    under: float
    btts: float                      # les deux équipes marquent
    top_score: tuple[int, int]
    top_score_prob: float
    top_scores: list = field(default_factory=list)
    matrix: np.ndarray | None = None
    line: float = OVER_UNDER_LINE
    model_version: str = MODEL_VERSION

    @property
    def pick(self) -> str:
        """Issue la plus probable.

        ⚠️ Il faut expliciter `key=` : `max()` sur une liste de tuples compare
        d'abord le premier élément, donc ici les chaînes "1" < "2" < "X", et le
        match nul l'emporterait systématiquement quelle que soit la probabilité.
        """
        return max(
            [("1", self.p_home), ("X", self.p_draw), ("2", self.p_away)],
            key=lambda item: item[1],
        )[0]

    @property
    def pick_prob(self) -> float:
        return max(self.p_home, self.p_draw, self.p_away)

    @property
    def total_goals(self) -> float:
        return self.lam_home + self.lam_away


def predict_match(
    home: TeamStrength,
    away: TeamStrength,
    baseline: LeagueBaseline,
    max_goals: int = MAX_GOALS,
    line: float = OVER_UNDER_LINE,
) -> FootballPrediction:
    """Pronostic complet d'un match de football. Aucune saisie manuelle."""
    lam_h, lam_a = expected_goals(home, away, baseline)
    m = score_matrix(lam_h, lam_a, max_goals=max_goals)

    n = m.shape[0]
    idx = np.arange(n)
    lower = np.tril(m, k=-1)   # i > j  -> victoire domicile
    upper = np.triu(m, k=1)    # j > i  -> victoire extérieur
    p_home = float(lower.sum())
    p_draw = float(np.trace(m))
    p_away = float(upper.sum())

    # Over/Under : somme des cellules où i + j > line
    goal_sum = idx[:, None] + idx[None, :]
    p_over = float(m[goal_sum > line].sum())
    p_under = float(m[goal_sum < line].sum())

    # BTTS : les deux >= 1
    p_btts = float(m[1:, 1:].sum())

    # Score exact le plus probable + top 3
    flat = [(int(i), int(j), float(m[i, j])) for i in range(n) for j in range(n)]
    flat.sort(key=lambda t: t[2], reverse=True)
    top = flat[0]

    return FootballPrediction(
        lam_home=lam_h,
        lam_away=lam_a,
        p_home=round(p_home, 4),
        p_draw=round(p_draw, 4),
        p_away=round(p_away, 4),
        over=round(p_over, 4),
        under=round(p_under, 4),
        btts=round(p_btts, 4),
        top_score=(top[0], top[1]),
        top_score_prob=round(top[2], 4),
        top_scores=[{"score": f"{i}-{j}", "p": round(p, 4)} for i, j, p in flat[:5]],
        matrix=m,
        line=line,
    )


# ---------------------------------------------------------------------------
# Cotes implicites (utile pour repérer de la valeur, pas pour parier à l'aveugle)
# ---------------------------------------------------------------------------
def implied_odds(p: float, margin: float = 0.0) -> float | None:
    """Cote décimale correspondant à une probabilité, marge bookmaker incluse."""
    if p <= 0:
        return None
    return round(1.0 / (p * (1.0 + margin)), 2)


def log_loss(predicted: tuple[float, float, float], outcome: tuple[int, int]) -> float:
    """Log-loss d'un résultat observé. Sert au backtest. outcome = (hg, ag)."""
    hg, ag = outcome
    probs = {
        "1": predicted[0],
        "X": predicted[1],
        "2": predicted[2],
    }
    result = "1" if hg > ag else ("2" if ag > hg else "X")
    p = max(probs[result], 1e-12)
    return -math.log(p)


def brier_1x2(predicted: tuple[float, float, float], outcome: tuple[int, int]) -> float:
    """Score de Brier 1X2 (0 = parfait, 2 = pire)."""
    hg, ag = outcome
    actual = (
        (1.0, 0.0, 0.0) if hg > ag else ((0.0, 0.0, 1.0) if ag > hg else (0.0, 1.0, 0.0))
    )
    return sum((p - a) ** 2 for p, a in zip(predicted, actual))
