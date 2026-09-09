"""Modèle de pronostic basket — points attendus ajustés domicile/extérieur.

On sépare l'efficacité offensive et défensive, on les normalise par la moyenne
de la ligue, puis on ajuste au rythme de jeu (pace) et à l'avantage du terrain.
La marge finale est traitée comme une loi normale d'écart-type connu, ce qui
donne directement les probabilités de victoire et over/under.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from scipy import stats

from ..config import BASKET_HOME_EDGE, BASKET_OVER_UNDER_LINE, BASKET_SPREAD_SD

MODEL_VERSION = "pts-normal-1.0"


@dataclass
class HoopsRating:
    team_id: int
    off_home: float      # points marqués par match à domicile
    def_home: float      # points encaissés par match à domicile
    off_away: float
    def_away: float
    pace: float = 100.0  # possessions par match

    @property
    def off(self) -> float:
        return (self.off_home + self.off_away) / 2

    @property
    def defn(self) -> float:
        return (self.def_home + self.def_away) / 2


@dataclass
class LeagueContext:
    avg_points_scored: float = 114.0   # moyenne par équipe et par match
    avg_pace: float = 100.0
    home_edge: float = BASKET_HOME_EDGE


def expected_points(
    home: HoopsRating,
    away: HoopsRating,
    ctx: LeagueContext,
) -> tuple[float, float]:
    """Points attendus de chaque équipe."""
    eps = 1e-9

    # Efficacités normalisées (>1 = au-dessus de la moyenne de la ligue).
    off_h = home.off_home / (ctx.avg_points_scored + eps)
    def_a = away.def_away / (ctx.avg_points_scored + eps)
    off_a = away.off_away / (ctx.avg_points_scored + eps)
    def_h = home.def_home / (ctx.avg_points_scored + eps)

    # Rythme moyen des deux équipes : un match rapide gonfle les deux scores.
    pace_factor = ((home.pace + away.pace) / 2) / (ctx.avg_pace + eps)

    exp_home = ctx.avg_points_scored * 0.5 * (off_h + def_a) * pace_factor + ctx.home_edge
    exp_away = ctx.avg_points_scored * 0.5 * (off_a + def_h) * pace_factor

    return round(max(exp_home, 60.0), 2), round(max(exp_away, 60.0), 2)


def predict_match(
    home: HoopsRating,
    away: HoopsRating,
    ctx: LeagueContext | None = None,
    line: float = BASKET_OVER_UNDER_LINE,
    spread_sd: float = BASKET_SPREAD_SD,
) -> dict:
    """Pronostic basket complet : vainqueur, spread, over/under.

    Note : le total de points a une variance supérieure à celle de la marge
    (les deux scores varient dans le même sens), d'où le facteur sqrt(2)
    appliqué à l'écart-type du total.
    """
    ctx = ctx or LeagueContext()
    exp_h, exp_a = expected_points(home, away, ctx)

    margin_mean = exp_h - exp_a
    total_mean = exp_h + exp_a
    total_sd = spread_sd * math.sqrt(2)

    # Victoire : P(marge > 0) avec marge ~ N(margin_mean, spread_sd)
    p_home = float(stats.norm.cdf(margin_mean / spread_sd))
    p_away = 1.0 - p_home

    p_over = float(1 - stats.norm.cdf((line - total_mean) / total_sd))
    p_under = 1.0 - p_over

    pick = "1" if p_home >= p_away else "2"
    return {
        "model_version": MODEL_VERSION,
        "lambda_home": exp_h,
        "lambda_away": exp_a,
        "p_home": round(p_home, 4),
        "p_draw": 0.0,
        "p_away": round(p_away, 4),
        "over_25": round(p_over, 4),
        "under": round(p_under, 4),
        "line": line,
        "spread_mean": round(margin_mean, 2),
        "total_mean": round(total_mean, 2),
        "pick": pick,
        "confidence": round(abs(p_home - p_away) * 100, 1),
    }
