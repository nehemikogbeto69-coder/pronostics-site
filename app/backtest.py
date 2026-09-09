"""Backtest : évaluer le modèle sur des matchs dont on connaît déjà le résultat.

C'est la seule façon honnête de savoir si un moteur de pronostic vaut quelque
chose. On recalcule les forces d'équipes en excluant le match testé (sinon le
match se « prédit lui-même » et le résultat est flatteur pour rien).

Métriques produites :
  - taux de réussite 1X2, comparé à la référence « toujours jouer domicile » ;
  - log-loss et score de Brier (qualité des probabilités, pas juste du choix) ;
  - calibration : les matchs annoncés à 70 % gagnent-ils ~70 % du temps ?
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from .models import football
from .sync import baseline_for, compute_team_stats, league_averages


@dataclass
class BacktestResult:
    n_matches: int = 0
    n_correct: int = 0
    log_loss_sum: float = 0.0
    brier_sum: float = 0.0
    baseline_correct: int = 0        # référence : toujours parier domicile
    bins: dict = field(default_factory=lambda: defaultdict(lambda: [0, 0]))  # [prédits, réussis]

    @property
    def accuracy(self) -> float:
        return self.n_correct / self.n_matches if self.n_matches else 0.0

    @property
    def baseline_accuracy(self) -> float:
        return self.baseline_correct / self.n_matches if self.n_matches else 0.0

    @property
    def log_loss(self) -> float:
        return self.log_loss_sum / self.n_matches if self.n_matches else 0.0

    @property
    def brier(self) -> float:
        return self.brier_sum / self.n_matches if self.n_matches else 0.0

    @property
    def edge_vs_baseline(self) -> float:
        return round((self.accuracy - self.baseline_accuracy) * 100, 2)

    def calibration_rows(self) -> list[dict]:
        rows = []
        for label, (pred_n, hits) in sorted(self.bins.items()):
            if pred_n == 0:
                continue
            rows.append({
                "band": label,
                "matches": pred_n,
                "hit_rate": round(hits / pred_n, 3),
            })
        return rows

    def summary(self) -> dict:
        return {
            "matches": self.n_matches,
            "accuracy": round(self.accuracy, 4),
            "baseline_accuracy": round(self.baseline_accuracy, 4),
            "edge_vs_baseline_pct": self.edge_vs_baseline,
            "log_loss": round(self.log_loss, 4),
            "brier": round(self.brier, 4),
            "calibration": self.calibration_rows(),
        }


def _band(p: float) -> str:
    for low, high, label in (
        (0.0, 0.40, "< 40 %"), (0.40, 0.50, "40-50 %"), (0.50, 0.60, "50-60 %"),
        (0.60, 0.70, "60-70 %"), (0.70, 1.01, ">= 70 %"),
    ):
        if low <= p < high:
            return label
    return "?"


def run_backtest(
    finished: list, league_id: int, last_n: int = 60, prior_weight: float | None = None,
) -> BacktestResult:
    """Évalue le modèle Poisson sur les `last_n` derniers matchs joués.

    Pour chaque match testé, les forces d'équipes sont recalculées sur les
    rencontres STRICTEMENT antérieures : aucune fuite d'information.
    """
    played = [
        f for f in finished
        if f.league_id == league_id and f.home_goals is not None and f.away_goals is not None
    ]
    played.sort(key=lambda f: f.kickoff_utc)
    if len(played) < 10:
        return BacktestResult()

    test_set = played[-last_n:]
    result = BacktestResult()

    for target in test_set:
        history = [f for f in played if f.kickoff_utc < target.kickoff_utc]
        if len(history) < 5:
            continue

        averages = league_averages(history)
        baseline = baseline_for(league_id, averages)
        stats = compute_team_stats(history, league_id)

        sh = stats.get(target.home_id)
        sa = stats.get(target.away_id)
        if not sh or not sa or sh["played"] < 2 or sa["played"] < 2:
            continue

        kw = {} if prior_weight is None else {"prior_weight": prior_weight}
        home_strength = football.compute_strength(
            sh["home_gf"], sh["home_ga"], sh["played_home"],
            sh["away_gf"], sh["away_ga"], sh["played_away"], baseline, **kw,
        )
        away_strength = football.compute_strength(
            sa["home_gf"], sa["home_ga"], sa["played_home"],
            sa["away_gf"], sa["away_ga"], sa["played_away"], baseline, **kw,
        )
        pred = football.predict_match(home_strength, away_strength, baseline)
        probs = (pred.p_home, pred.p_draw, pred.p_away)

        hg, ag = int(target.home_goals), int(target.away_goals)
        actual = "1" if hg > ag else ("2" if ag > hg else "X")
        predicted_pick = pred.pick

        result.n_matches += 1
        if predicted_pick == actual:
            result.n_correct += 1
        if actual == "1":
            result.baseline_correct += 1

        result.log_loss_sum += football.log_loss(probs, (hg, ag))
        result.brier_sum += football.brier_1x2(probs, (hg, ag))

        p_pick = max(probs)
        band = _band(p_pick)
        result.bins[band][0] += 1
        if predicted_pick == actual:
            result.bins[band][1] += 1

    return result


def roi_simulation(
    finished: list, league_id: int, last_n: int = 60, stake: float = 10.0,
    odds_margin: float = 0.06, min_confidence: float = 0.0,
    prior_weight: float | None = None,
) -> dict:
    """Simule un retour sur investissement à cote théorique (marge bookmaker incluse).

    ⚠️ La cote utilisée est DÉDUITE de notre propre probabilité, pas relevée
       chez un bookmaker. Ce chiffre mesure donc la cohérence du modèle, pas un
       profit réel. Un vrai calcul de ROI exige les cotes historiques du marché.
    """
    played = [
        f for f in finished
        if f.league_id == league_id and f.home_goals is not None and f.away_goals is not None
    ]
    played.sort(key=lambda f: f.kickoff_utc)
    test_set = played[-last_n:]

    bets, wins, profit = 0, 0, 0.0
    for target in test_set:
        history = [f for f in played if f.kickoff_utc < target.kickoff_utc]
        if len(history) < 5:
            continue
        averages = league_averages(history)
        baseline = baseline_for(league_id, averages)
        stats = compute_team_stats(history, league_id)
        sh, sa = stats.get(target.home_id), stats.get(target.away_id)
        if not sh or not sa or sh["played"] < 2 or sa["played"] < 2:
            continue

        kw = {} if prior_weight is None else {"prior_weight": prior_weight}
        hs = football.compute_strength(
            sh["home_gf"], sh["home_ga"], sh["played_home"],
            sh["away_gf"], sh["away_ga"], sh["played_away"], baseline, **kw,
        )
        as_ = football.compute_strength(
            sa["home_gf"], sa["home_ga"], sa["played_home"],
            sa["away_gf"], sa["away_ga"], sa["played_away"], baseline, **kw,
        )
        pred = football.predict_match(hs, as_, baseline)
        p_pick = max(pred.p_home, pred.p_draw, pred.p_away)
        if p_pick < min_confidence:
            continue

        odds = football.implied_odds(p_pick, margin=odds_margin)
        if not odds:
            continue
        actual = "1" if int(target.home_goals) > int(target.away_goals) else (
            "2" if int(target.away_goals) > int(target.home_goals) else "X"
        )
        bets += 1
        if pred.pick == actual:
            wins += 1
            profit += stake * (odds - 1)
        else:
            profit -= stake

    return {
        "bets": bets,
        "wins": wins,
        "win_rate": round(wins / bets, 4) if bets else 0.0,
        "stake_total": round(bets * stake, 2),
        "profit": round(profit, 2),
        "roi_pct": round(profit / (bets * stake) * 100, 2) if bets else 0.0,
        "note": "Cotes théoriques déduites du modèle, pas celles du marché.",
    }
