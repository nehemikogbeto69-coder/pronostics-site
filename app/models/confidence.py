"""Indice de confiance commun à tous les modèles.

Deux composantes :
  1. la MARGE : écart entre la meilleure issue et la deuxième meilleure ;
  2. un MALUS D'ENTROPIE : un modèle qui répartit 34/33/33 n'a rien à dire,
     même si sa « meilleure » issue dépasse légèrement les autres.

Résultat : un pourcentage 0-100, plus honnête que la simple probabilité brute,
qui surestime toujours la confiance sur les matchs serrés.
"""

from __future__ import annotations

import math


def shannon_entropy(probs: list[float]) -> float:
    """Entropie normalisée dans [0, 1]. 0 = certitude, 1 = hasard total."""
    ps = [p for p in probs if p > 0]
    if len(ps) < 2:
        return 0.0
    h = -sum(p * math.log(p) for p in ps)
    return h / math.log(len(ps))


def confidence(probs: list[float], floor: float = 5.0, ceiling: float = 97.0) -> float:
    """Indice de confiance 0-100 à partir d'un vecteur de probabilités.

    Formule : 100 * (marge / (marge + entropie)), puis mise à l'échelle.
    """
    ps = [p for p in probs if p > 0]
    if not ps:
        return floor
    if len(ps) == 1:
        return min(ceiling, 100.0 * ps[0])

    ranked = sorted(ps, reverse=True)
    margin = ranked[0] - ranked[1]
    ent = shannon_entropy(ps)

    # ratio dans [0, 1] : marge forte + entropie faible -> proche de 1
    denom = margin + ent
    ratio = margin / denom if denom > 0 else 0.0

    # L'entropie seule doit pouvoir faire tomber la confiance même si la marge
    # est correcte (cas 0.45 / 0.44 / 0.11).
    ratio *= 1.0 - 0.35 * ent

    value = 100.0 * ratio
    return round(min(max(value, floor), ceiling), 1)


def confidence_label(value: float) -> str:
    if value >= 65:
        return "Élevée"
    if value >= 45:
        return "Moyenne"
    if value >= 28:
        return "Faible"
    return "Très faible"


def value_edge(model_prob: float, bookmaker_odds: float) -> float:
    """Avantage espéré si la cote du bookmaker est supérieure à notre probabilité.

    > 0 signifie que le bookmaker paie plus cher que ce que le modèle estime juste.
    À lire comme une indication, jamais comme une garantie.
    """
    if bookmaker_odds <= 1.0:
        return 0.0
    return round((model_prob * bookmaker_odds - 1.0) * 100, 2)
