"""Saisie manuelle de matchs.

Complément au système API, pas un remplacement : le sync automatique reste
intact. Ces fonctions servent quand la source automatique ne couvre pas la
compétition voulue — typiquement la saison en cours avec un plan gratuit
API-Football limité à 2022-2024.

Le point important : un match saisi passe par **exactement le même moteur**
(`models.football.predict_match`) qu'un match issu de l'API. Seule la provenance
des statistiques diffère — vous les fournissez au lieu qu'elles soient
téléchargées. Le pronostic, la matrice des scores et l'indice de confiance sont
donc calculés de façon identique.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from . import db
from .config import DATA_MODE, LEAGUES, OVER_UNDER_LINE
from .models import confidence, football

# Les identifiants de matchs et d'équipes saisis à la main sont NÉGATIFS.
# API-Football numérote en positif : aucun risque de collision, et le sync
# automatique ne peut donc jamais écraser une saisie manuelle.
MANUAL_FIXTURE_BASE = -1_000_000
MANUAL_TEAM_BASE = -1_000_000


class ManualMatchError(ValueError):
    """Saisie invalide. Le message est destiné à être affiché à l'utilisateur."""


# ---------------------------------------------------------------------------
# Identifiants déterministes
# ---------------------------------------------------------------------------
def manual_team_id(name: str, sport: str = "football") -> int:
    """Identifiant négatif stable pour une équipe saisie à la main.

    Saisir deux fois « Olympique de Marseille » doit donner le même identifiant,
    sinon on créerait des doublons à chaque saisie.
    """
    key = f"manual:{sport}:{_normalize(name)}".encode()
    return MANUAL_TEAM_BASE - (int(hashlib.sha256(key).hexdigest()[:8], 16) % 900_000)


def manual_fixture_id(home_name: str, away_name: str, kickoff_utc: str) -> int:
    key = f"{_normalize(home_name)}|{_normalize(away_name)}|{kickoff_utc}".encode()
    return MANUAL_FIXTURE_BASE - (int(hashlib.sha256(key).hexdigest()[:8], 16) % 900_000)


def _normalize(name: str) -> str:
    return " ".join(name.strip().lower().split())


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
def validate_payload(p: dict) -> dict:
    """Vérifie la saisie et retourne des données nettoyées.

    Lève ManualMatchError avec un message compréhensible si quelque chose
    cloche : mieux vaut refuser une saisie douteuse que produire un pronostic
    sans signification.
    """
    home = (p.get("home_name") or "").strip()
    away = (p.get("away_name") or "").strip()
    if not home:
        raise ManualMatchError("Le nom de l'équipe à domicile est obligatoire.")
    if not away:
        raise ManualMatchError("Le nom de l'équipe à l'extérieur est obligatoire.")
    if _normalize(home) == _normalize(away):
        raise ManualMatchError("Les deux équipes doivent être différentes.")

    kickoff = _parse_kickoff(p.get("kickoff_utc"))

    league_id = int(p.get("league_id") or 39)
    if league_id not in LEAGUES:
        raise ManualMatchError(
            f"Ligue inconnue (id {league_id}). Ligues disponibles : "
            + ", ".join(f"{v['name']} ({k})" for k, v in LEAGUES.items())
            + ". Ajoutez-la dans app/config.py pour en couvrir une autre."
        )

    sides = {}
    for prefix, label in (("home", home), ("away", away)):
        n_home = _positive_int(p.get(f"{prefix}_n_home"), f"{label} — matchs à domicile")
        n_away = _positive_int(p.get(f"{prefix}_n_away"), f"{label} — matchs à l'extérieur")
        if n_home < 1 or n_away < 1:
            raise ManualMatchError(
                f"{label} : il faut au moins 1 match de référence à domicile "
                f"et 1 à l'extérieur."
            )
        gf_home = _non_negative(p.get(f"{prefix}_gf_home"), f"{label} — buts marqués à domicile")
        ga_home = _non_negative(p.get(f"{prefix}_ga_home"), f"{label} — buts encaissés à domicile")
        gf_away = _non_negative(p.get(f"{prefix}_gf_away"), f"{label} — buts marqués à l'extérieur")
        ga_away = _non_negative(p.get(f"{prefix}_ga_away"), f"{label} — buts encaissés à l'extérieur")

        # Cohérence : des totaux de buts sur N matchs ne peuvent pas dépasser
        # un plafond crédible (9 buts par match est déjà extrême).
        for total, n, what in (
            (gf_home, n_home, "marqués à domicile"),
            (ga_home, n_home, "encaissés à domicile"),
            (gf_away, n_away, "marqués à l'extérieur"),
            (ga_away, n_away, "encaissés à l'extérieur"),
        ):
            if total > n * 9:
                raise ManualMatchError(
                    f"{label} — {total} buts {what} sur {n} match(s), c'est "
                    f"invraisemblable. Saisissez des TOTAUX de buts, pas des "
                    f"moyennes, ou corrigez le nombre de matchs."
                )
        sides[prefix] = {
            "n_home": n_home, "n_away": n_away,
            "gf_home": gf_home, "ga_home": ga_home,
            "gf_away": gf_away, "ga_away": ga_away,
        }

    return {
        "home_name": home,
        "away_name": away,
        "kickoff_utc": kickoff,
        "league_id": league_id,
        "round": (p.get("round") or "").strip(),
        "venue": (p.get("venue") or "").strip(),
        **sides,
    }


def _parse_kickoff(value) -> str:
    """Accepte une date ISO, avec ou sans fuseau, et normalise en UTC."""
    if not value:
        raise ManualMatchError("La date et l'heure du match sont obligatoires.")
    raw = str(value).strip().replace(" ", "T")
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ManualMatchError(
            f"Date illisible : « {value} ». Format attendu : 2026-09-20T15:00"
        ) from exc
    if dt.tzinfo is None:
        # Une date sans fuseau est interprétée comme heure locale du visiteur ;
        # on la note telle quelle en UTC pour rester simple et prévisible.
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec="minutes")


def _positive_int(value, what: str) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError) as exc:
        raise ManualMatchError(f"{what} : nombre de matchs invalide.") from exc
    if n < 0:
        raise ManualMatchError(f"{what} : ne peut pas être négatif.")
    return n


def _non_negative(value, what: str) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError) as exc:
        raise ManualMatchError(f"{what} : valeur invalide.") from exc
    if v < 0:
        raise ManualMatchError(f"{what} : ne peut pas être négatif.")
    return v


# ---------------------------------------------------------------------------
# Pronostic — même moteur que le reste du site
# ---------------------------------------------------------------------------
def compute_prediction(clean: dict) -> tuple[football.FootballPrediction, float, dict]:
    """Calcule le pronostic d'un match saisi à la main.

    Appelle `football.predict_match`, exactement comme le fait le sync pour les
    matchs issus de l'API. Les seules différences : les forces viennent des
    statistiques saisies, et les moyennes de ligue viennent de la table
    `leagues` (donc des données réelles observées si le sync a déjà tourné).
    """
    baseline = _baseline_for(clean["league_id"])

    def strength(prefix: str) -> football.TeamStrength:
        s = clean[prefix]
        return football.compute_strength(
            goals_for_home=s["gf_home"],
            goals_against_home=s["ga_home"],
            played_home=s["n_home"],
            goals_for_away=s["gf_away"],
            goals_against_away=s["ga_away"],
            played_away=s["n_away"],
            baseline=baseline,
        )

    home = strength("home")
    away = strength("away")
    pred = football.predict_match(home, away, baseline, line=OVER_UNDER_LINE)
    conf = confidence.confidence([pred.p_home, pred.p_draw, pred.p_away])

    detail = {
        "source": "manual",
        "strength_home": {
            "attack": round(home.attack, 3), "defence": round(home.defence, 3),
            "attack_home": round(home.attack_home, 3),
            "defence_home": round(home.defence_home, 3),
            "attack_away": round(home.attack_away, 3),
            "defence_away": round(home.defence_away, 3),
        },
        "strength_away": {
            "attack": round(away.attack, 3), "defence": round(away.defence, 3),
            "attack_home": round(away.attack_home, 3),
            "defence_home": round(away.defence_home, 3),
            "attack_away": round(away.attack_away, 3),
            "defence_away": round(away.defence_away, 3),
        },
        "baseline": {
            "home_avg_goals": baseline.home_avg_goals,
            "away_avg_goals": baseline.away_avg_goals,
            "home_advantage": baseline.home_advantage,
        },
        "confidence_label": confidence.confidence_label(conf),
        # La forme et le H2H ne sont pas disponibles pour une saisie manuelle.
        # Le dire explicitement évite de laisser croire qu'ils ont été ignorés.
        "form_home": None,
        "form_away": None,
        "h2h": None,
        "injuries": [],
    }
    return pred, conf, detail


def _baseline_for(league_id: int) -> football.LeagueBaseline:
    """Moyennes observées en base si disponibles, sinon celles de la config."""
    cfg = LEAGUES[league_id]
    row = db.query_one("SELECT * FROM leagues WHERE id = ?", (league_id,))
    home_avg = row["home_avg_goals"] if row and row["home_avg_goals"] else None
    away_avg = row["away_avg_goals"] if row and row["away_avg_goals"] else None
    if home_avg and away_avg:
        return football.LeagueBaseline(
            home_avg_goals=float(home_avg),
            away_avg_goals=float(away_avg),
            home_advantage=cfg.get("home_advantage", 1.18),
        )
    return football.LeagueBaseline(
        home_avg_goals=cfg.get("home_avg_goals", 1.40),
        away_avg_goals=cfg.get("away_avg_goals", 1.15),
        home_advantage=cfg.get("home_advantage", 1.18),
    )


# ---------------------------------------------------------------------------
# Écriture en base
# ---------------------------------------------------------------------------
def create_manual_match(payload: dict) -> dict:
    """Valide, calcule le pronostic et enregistre. Retourne le match créé."""
    clean = validate_payload(payload)
    now_iso = db.utcnow()

    fixture_id = manual_fixture_id(
        clean["home_name"], clean["away_name"], clean["kickoff_utc"]
    )
    if db.query_one("SELECT 1 FROM fixtures WHERE id = ? AND sport = 'football'",
                    (fixture_id,)):
        raise ManualMatchError(
            "Ce match existe déjà (mêmes équipes, même date et heure)."
        )

    home_id = manual_team_id(clean["home_name"])
    away_id = manual_team_id(clean["away_name"])

    for tid, name in ((home_id, clean["home_name"]), (away_id, clean["away_name"])):
        db.upsert("teams", {
            "id": tid, "league_id": clean["league_id"], "name": name,
            "short": "", "logo": "", "venue": clean["venue"], "sport": "football",
        }, ["id", "sport"])

    db.upsert("fixtures", {
        "id": fixture_id, "league_id": clean["league_id"], "sport": "football",
        "home_id": home_id, "away_id": away_id,
        "kickoff_utc": clean["kickoff_utc"],
        "round": clean["round"] or "Saisie manuelle",
        "venue": clean["venue"], "status": "NS",
        "home_goals": None, "away_goals": None,
        "season": _season_of(clean["kickoff_utc"]),
        "source": "manual",
        "created_at": now_iso, "updated_at": now_iso,
    }, ["id", "sport"])

    db.upsert("manual_matches", {
        "fixture_id": fixture_id, "sport": "football",
        "league_id": clean["league_id"],
        "home_name": clean["home_name"], "away_name": clean["away_name"],
        "kickoff_utc": clean["kickoff_utc"],
        "round": clean["round"], "venue": clean["venue"],
        "home_gf_home": clean["home"]["gf_home"],
        "home_ga_home": clean["home"]["ga_home"],
        "home_gf_away": clean["home"]["gf_away"],
        "home_ga_away": clean["home"]["ga_away"],
        "home_n_home": clean["home"]["n_home"],
        "home_n_away": clean["home"]["n_away"],
        "away_gf_home": clean["away"]["gf_home"],
        "away_ga_home": clean["away"]["ga_home"],
        "away_gf_away": clean["away"]["gf_away"],
        "away_ga_away": clean["away"]["ga_away"],
        "away_n_home": clean["away"]["n_home"],
        "away_n_away": clean["away"]["n_away"],
        "created_at": now_iso, "updated_at": now_iso,
    }, ["fixture_id"])

    pred, conf, detail = compute_prediction(clean)
    _store_prediction(fixture_id, pred, conf, detail, now_iso)
    _store_team_stats(fixture_id, clean, home_id, away_id, now_iso)

    return {"fixture_id": fixture_id, "home_id": home_id, "away_id": away_id}


def _store_team_stats(fixture_id: int, clean: dict, home_id: int, away_id: int,
                      now_iso: str) -> None:
    """Enregistre les statistiques saisies sous forme de team_stats.

    Sans ça, l'écran de détail d'un match n'afficherait aucune force d'attaque
    ni de défense pour les équipes saisies à la main. On ne crée pas de ligne
    au classement : ces équipes ne disputent pas le championnat suivi, les
    mêler fausserait le tableau.
    """
    season = _season_of(clean["kickoff_utc"])
    for prefix, tid in (("home", home_id), ("away", away_id)):
        s = clean[prefix]
        played = s["n_home"] + s["n_away"]
        gf = s["gf_home"] + s["gf_away"]
        ga = s["ga_home"] + s["ga_away"]
        db.upsert("team_stats", {
            "team_id": tid, "league_id": clean["league_id"], "sport": "football",
            "season": season,
            "played": played, "played_home": s["n_home"], "played_away": s["n_away"],
            "goals_for": gf, "goals_against": ga,
            "home_gf": s["gf_home"], "home_ga": s["ga_home"],
            "away_gf": s["gf_away"], "away_ga": s["ga_away"],
            # Victoires/nuls/défaites inconnus pour une saisie manuelle :
            # laisser 0 plutôt qu'inventer des valeurs.
            "points": 0, "wins": 0, "draws": 0, "losses": 0, "position": 0,
            "updated_at": now_iso,
        }, ["team_id", "league_id", "sport", "season"])


def _store_prediction(fixture_id: int, pred, conf: float, detail: dict, now_iso: str) -> None:
    matrix_json = None
    if pred.matrix is not None:
        matrix_json = json.dumps(
            [[round(float(pred.matrix[i, j]), 4) for j in range(6)] for i in range(6)]
        )
    pick_label = {
        "1": "Victoire domicile", "X": "Match nul", "2": "Victoire extérieur",
    }.get(pred.pick, pred.pick)

    db.upsert("predictions", {
        "fixture_id": fixture_id, "sport": "football", "model": pred.model_version,
        "lambda_home": pred.lam_home, "lambda_away": pred.lam_away,
        "p_home": pred.p_home, "p_draw": pred.p_draw, "p_away": pred.p_away,
        "pick": pred.pick, "pick_label": pick_label, "confidence": conf,
        "over_25": pred.over, "btts": pred.btts,
        "top_score": f"{pred.top_score[0]}-{pred.top_score[1]}",
        "top_score_prob": pred.top_score_prob,
        "score_matrix": matrix_json,
        "detail_json": json.dumps(detail, ensure_ascii=False),
        "created_at": now_iso, "model_version": pred.model_version,
    }, ["fixture_id"])


def recompute_manual_match(fixture_id: int) -> bool:
    """Recalcule le pronostic d'un match saisi, à partir des stats enregistrées.

    Utile après un sync : les moyennes de la ligue ont pu être affinées sur des
    résultats réels, le pronostic gagne à être recalculé avec.
    """
    row = db.query_one("SELECT * FROM manual_matches WHERE fixture_id = ?", (fixture_id,))
    if row is None:
        return False
    clean = {
        "home_name": row["home_name"], "away_name": row["away_name"],
        "kickoff_utc": row["kickoff_utc"], "league_id": row["league_id"],
        "round": row["round"] or "", "venue": row["venue"] or "",
        "home": {
            "gf_home": row["home_gf_home"], "ga_home": row["home_ga_home"],
            "gf_away": row["home_gf_away"], "ga_away": row["home_ga_away"],
            "n_home": row["home_n_home"], "n_away": row["home_n_away"],
        },
        "away": {
            "gf_home": row["away_gf_home"], "ga_home": row["away_ga_home"],
            "gf_away": row["away_gf_away"], "ga_away": row["away_ga_away"],
            "n_home": row["away_n_home"], "n_away": row["away_n_away"],
        },
    }
    pred, conf, detail = compute_prediction(clean)
    _store_prediction(fixture_id, pred, conf, detail, db.utcnow())
    return True


def recompute_all_manual() -> int:
    """Recalcule tous les matchs saisis. Appelé après chaque sync."""
    rows = db.query("SELECT fixture_id FROM manual_matches")
    return sum(1 for r in rows if recompute_manual_match(r["fixture_id"]))


def delete_manual_match(fixture_id: int) -> bool:
    """Supprime un match saisi et ses données associées."""
    row = db.query_one("SELECT 1 FROM manual_matches WHERE fixture_id = ?", (fixture_id,))
    if row is None:
        return False
    with db.tx() as conn:
        conn.execute("DELETE FROM manual_matches WHERE fixture_id = ?", (fixture_id,))
        conn.execute("DELETE FROM predictions WHERE fixture_id = ?", (fixture_id,))
        conn.execute("DELETE FROM fixtures WHERE id = ? AND sport = 'football'", (fixture_id,))
    return True


def _season_of(kickoff_utc: str) -> int:
    """Saison européenne : n si le match tombe en août ou après, sinon n-1."""
    try:
        dt = datetime.fromisoformat(kickoff_utc)
    except ValueError:
        return datetime.now(timezone.utc).year
    return dt.year if dt.month >= 7 else dt.year - 1
