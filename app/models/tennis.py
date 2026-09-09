"""Modèle de pronostic tennis — Elo ajusté par surface.

Principe :
  - chaque joueur porte un rating Elo, mis à jour après chaque match ;
  - le rating est ajusté selon la surface (un spécialiste de terre battue n'a
    pas la même force sur gazon) via un delta appris sur ses résultats ;
  - la différence de rating ajusté est convertie en probabilité de victoire
    par la logistique classique E = 1 / (1 + 10^(-Δ/scale)), avec un facteur
    de raideur pour tenir compte du format (le meilleur au 5 sets gagne plus
    souvent que sur un match sec).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from ..config import TENNIS_ELO_SCALE, TENNIS_K_FACTOR, TENNIS_SHARPNESS

MODEL_VERSION = "elo-surface-1.0"

SURFACES = ("hard", "clay", "grass", "indoor")


@dataclass
class PlayerRating:
    player_id: int
    name: str = ""
    elo: float = 1500.0
    surface_delta: dict[str, float] | None = None
    matches_played: int = 0

    def __post_init__(self) -> None:
        if self.surface_delta is None:
            self.surface_delta = {s: 0.0 for s in SURFACES}

    def effective(self, surface: str) -> float:
        return self.elo + self.surface_delta.get(surface, 0.0)


def expected_score(elo_a: float, elo_b: float, scale: float = TENNIS_ELO_SCALE) -> float:
    """Espérance de résultat de A contre B, dans [0, 1]."""
    return 1.0 / (1.0 + 10 ** ((elo_b - elo_a) / scale))


def win_probability(
    a: PlayerRating,
    b: PlayerRating,
    surface: str = "hard",
    sharpness: float = TENNIS_SHARPNESS,
) -> float:
    """P(A bat B) sur la surface donnée.

    Point de départ : la formule Elo standard E = 1 / (1 + 10^(-Δ/400)).
    `sharpness` est un multiplicateur appliqué au logit, pas un facteur brut :
    1.0 redonne exactement l'Elo classique, 1.25 accentue légèrement les écarts
    pour tenir compte du format long (le meilleur gagne plus souvent sur 3 ou
    5 sets que sur un match sec).

    ⚠️ Un multiplicateur élevé (5 ou plus) sature la logistique : un écart de
    +25 points Elo produirait 65 % de chances de victoire, ce qui est très
    au-dessus de ce qu'on observe réellement sur le circuit.
    """
    e = expected_score(a.effective(surface), b.effective(surface))
    e = min(max(e, 1e-6), 1 - 1e-6)
    logit = math.log(e / (1 - e))
    sharpened = 1.0 / (1.0 + math.exp(-sharpness * logit))
    return min(max(sharpened, 0.01), 0.99)


def update_elo(
    winner: PlayerRating,
    loser: PlayerRating,
    surface: str = "hard",
    k: float = TENNIS_K_FACTOR,
) -> tuple[float, float]:
    """Retourne les nouveaux ratings après un match (sans les écrire)."""
    ew = expected_score(winner.effective(surface), loser.effective(surface))
    delta = k * (1.0 - ew)
    return round(winner.elo + delta, 2), round(loser.elo - delta, 2)


def predict_match(
    a: PlayerRating,
    b: PlayerRating,
    surface: str = "hard",
) -> dict:
    """Pronostic tennis complet."""
    p_a = win_probability(a, b, surface)
    p_b = 1.0 - p_a
    pick = "A" if p_a >= p_b else "B"
    return {
        "model_version": MODEL_VERSION,
        "surface": surface,
        "p_home": round(p_a, 4),
        "p_away": round(p_b, 4),
        "p_draw": 0.0,
        "elo_home": round(a.effective(surface), 1),
        "elo_away": round(b.effective(surface), 1),
        "pick": pick,
        "confidence": round(abs(p_a - p_b) * 100, 1),
    }


# ---------------------------------------------------------------------------
# Estimation du nombre de sets (bonus, utile pour les paris "over sets")
# ---------------------------------------------------------------------------
def sets_probability(p_strong: float) -> dict:
    """P(2 sets) et P(3 sets) en format au meilleur des 3.

    Approximation standard : P(match en 2 sets) = p² + (1-p)².
    """
    p2 = p_strong**2 + (1 - p_strong) ** 2
    return {"p_2_sets": round(p2, 4), "p_3_sets": round(1 - p2, 4)}
