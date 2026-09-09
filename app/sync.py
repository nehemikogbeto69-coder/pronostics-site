"""Pipeline de synchronisation.

Enchaîne, sans aucune intervention manuelle :
    1. récupération des matchs à venir
    2. calcul des statistiques d'équipes à partir des matchs joués
    3. dérivation des forces d'attaque / défense et des moyennes de ligue
    4. récupération forme, confrontations directes, blessés
    5. calcul du pronostic (Poisson / Elo / points attendus)
    6. écriture en base

C'est cette fonction que le planificateur exécute toutes les N minutes.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import datetime, timezone

from . import db
from .config import DATA_MODE, FIXTURE_DAYS_AHEAD, FORM_WINDOW, LEAGUES
from .models import basketball, confidence, football, tennis
from .providers import get_provider
from .providers.demo import DemoBasketProvider, DemoTennisProvider

log = logging.getLogger("prono.sync")


# ---------------------------------------------------------------------------
# Moyennes de ligue, calculées sur les vrais résultats
# ---------------------------------------------------------------------------
def league_averages(finished: list) -> dict[int, tuple[float, float, int]]:
    """Par ligue : (buts/match à domicile, buts/match à l'extérieur, nb matchs).

    Calculé sur les résultats réellement observés — pas sur des constantes.
    Les valeurs de config ne servent que de repli avant les premières journées.
    """
    acc: dict[int, list[tuple[int, int]]] = defaultdict(list)
    for f in finished:
        if f.home_goals is None or f.away_goals is None:
            continue
        acc[f.league_id].append((int(f.home_goals), int(f.away_goals)))

    out: dict[int, tuple[float, float, int]] = {}
    for lid, scores in acc.items():
        n = len(scores)
        if n == 0:
            continue
        home_avg = sum(s[0] for s in scores) / n
        away_avg = sum(s[1] for s in scores) / n
        out[lid] = (home_avg, away_avg, n)
    return out


def baseline_for(league_id: int, averages: dict) -> football.LeagueBaseline:
    """Référence de buts de la ligue, par champ.

    Priorité aux moyennes réellement observées sur les résultats, avec repli
    champ par champ sur la configuration. Un sync partiel peut ne mesurer
    qu'une des deux moyennes : il ne faut alors pas jeter l'autre.
    """
    cfg = LEAGUES.get(league_id, {})
    home_avg = cfg.get("home_avg_goals", 1.40)
    away_avg = cfg.get("away_avg_goals", 1.15)

    if league_id in averages:
        obs_home, obs_away, _ = averages[league_id]
        if obs_home > 0:
            home_avg = round(obs_home, 3)
        if obs_away > 0:
            away_avg = round(obs_away, 3)

    return football.LeagueBaseline(
        home_avg_goals=home_avg,
        away_avg_goals=away_avg,
        home_advantage=cfg.get("home_advantage", 1.18),
    )


def ensure_leagues() -> None:
    """Garantit que les ligues configurées existent en base.

    Sans ça, un sync lancé hors du démarrage FastAPI (tests, script) écrirait
    les moyennes observées dans une table vide et les perdrait silencieusement.
    """
    for lid, cfg in LEAGUES.items():
        db.upsert("leagues", {
            "id": lid, "name": cfg["name"], "country": cfg["country"],
            "sport": cfg["sport"],
            "home_avg_goals": cfg["home_avg_goals"],
            "away_avg_goals": cfg["away_avg_goals"],
            "home_advantage": cfg["home_advantage"],
        }, ["id"])


# ---------------------------------------------------------------------------
# Stats d'équipes dérivées des résultats
# ---------------------------------------------------------------------------
def compute_team_stats(finished: list, league_id: int) -> dict[int, dict]:
    """Agrège les matchs joués en stats par équipe, domicile et extérieur séparés."""
    stats: dict[int, dict] = defaultdict(lambda: {
        "played": 0, "played_home": 0, "played_away": 0,
        "home_gf": 0, "home_ga": 0, "away_gf": 0, "away_ga": 0,
        "goals_for": 0, "goals_against": 0,
        "wins": 0, "draws": 0, "losses": 0, "points": 0,
    })

    for f in finished:
        if f.league_id != league_id:
            continue
        if f.home_goals is None or f.away_goals is None:
            continue
        hg, ag = int(f.home_goals), int(f.away_goals)
        h, a = stats[f.home_id], stats[f.away_id]

        h["played"] += 1; h["played_home"] += 1
        h["home_gf"] += hg; h["home_ga"] += ag
        h["goals_for"] += hg; h["goals_against"] += ag

        a["played"] += 1; a["played_away"] += 1
        a["away_gf"] += ag; a["away_ga"] += hg
        a["goals_for"] += ag; a["goals_against"] += hg

        if hg > ag:
            h["wins"] += 1; h["points"] += 3; a["losses"] += 1
        elif hg == ag:
            h["draws"] += 1; a["draws"] += 1
            h["points"] += 1; a["points"] += 1
        else:
            a["wins"] += 1; a["points"] += 3; h["losses"] += 1

    # Classement implicite (points, puis différence de buts)
    ranked = sorted(
        stats.items(),
        key=lambda kv: (-kv[1]["points"], -(kv[1]["goals_for"] - kv[1]["goals_against"])),
    )
    for pos, (tid, s) in enumerate(ranked, start=1):
        s["position"] = pos
    return stats


def persist_team_stats(stats: dict[int, dict], league_id: int, season: int) -> None:
    now = db.utcnow()
    for tid, s in stats.items():
        db.upsert("team_stats", {
            "team_id": tid, "league_id": league_id, "sport": "football", "season": season,
            "played": s["played"], "played_home": s["played_home"], "played_away": s["played_away"],
            "goals_for": s["goals_for"], "goals_against": s["goals_against"],
            "home_gf": s["home_gf"], "home_ga": s["home_ga"],
            "away_gf": s["away_gf"], "away_ga": s["away_ga"],
            "points": s["points"], "wins": s["wins"], "draws": s["draws"],
            "losses": s["losses"], "position": s.get("position", 0),
            "attack_strength": s.get("attack_strength"),
            "defence_strength": s.get("defence_strength"),
            "updated_at": now,
        }, ["team_id", "league_id", "sport", "season"])


# ---------------------------------------------------------------------------
# Sync football
# ---------------------------------------------------------------------------
def sync_football(provider, league_ids: list[int], days_ahead: int = FIXTURE_DAYS_AHEAD) -> dict:
    ensure_leagues()
    now_iso = db.utcnow()
    db.execute(
        "INSERT INTO sync_log (started_at, mode, ok, message) VALUES (?, ?, 0, 'en cours')",
        (now_iso, provider.name),
    )

    # 1. Équipes
    for lid in league_ids:
        for t in provider.fetch_teams(lid):
            db.upsert("teams", {
                "id": t.id, "league_id": t.league_id or lid, "name": t.name,
                "short": t.short, "logo": t.logo, "venue": t.venue, "sport": "football",
            }, ["id", "sport"])

    # 2. Matchs joués -> stats -> forces
    finished = provider.fetch_finished(league_ids, limit=400)
    for f in finished:
        db.upsert("fixtures", _fixture_row(f, now_iso, provider.name), ["id", "sport"])

    averages = league_averages(finished)
    season = max((f.season for f in finished if f.season), default=2026)

    strengths: dict[int, football.TeamStrength] = {}
    for lid in league_ids:
        baseline = baseline_for(lid, averages)
        stats = compute_team_stats(finished, lid)
        for tid, s in stats.items():
            st = football.compute_strength(
                goals_for_home=s["home_gf"], goals_against_home=s["home_ga"],
                played_home=s["played_home"],
                goals_for_away=s["away_gf"], goals_against_away=s["away_ga"],
                played_away=s["played_away"],
                baseline=baseline, team_id=tid,
            )
            strengths[tid] = st
            # Les forces sont aussi écrites dans team_stats : c'est ce que lit
            # l'écran « Classement et forces ». Sans ça, les colonnes restaient à 0.
            s["attack_strength"] = round(st.attack, 4)
            s["defence_strength"] = round(st.defence, 4)
        persist_team_stats(stats, lid, season)
        # On garde les moyennes réellement observées en base, pour l'affichage.
        if lid in averages:
            ha, aa, _ = averages[lid]
            db.execute(
                "UPDATE leagues SET home_avg_goals=?, away_avg_goals=? WHERE id=?",
                (round(ha, 3), round(aa, 3), lid),
            )

    # 3. Matchs à venir
    upcoming = provider.fetch_upcoming(league_ids, days_ahead)
    for f in upcoming:
        db.upsert("fixtures", _fixture_row(f, now_iso, provider.name), ["id", "sport"])

    # 4. Pronostics, forme, H2H, blessés
    predicted = 0
    for f in upcoming:
        home = strengths.get(f.home_id)
        away = strengths.get(f.away_id)
        if not home or not away:
            log.info("match %s ignoré : stats insuffisantes", f.id)
            continue
        baseline = baseline_for(f.league_id, averages)
        pred = football.predict_match(home, away, baseline)
        conf = confidence.confidence([pred.p_home, pred.p_draw, pred.p_away])

        detail = {
            "form_home": _safe_form(provider, f.home_id, f.league_id),
            "form_away": _safe_form(provider, f.away_id, f.league_id),
            "h2h": _safe_h2h(provider, f.home_id, f.away_id),
            "injuries": _safe_injuries(provider, f.id),
            "strength_home": {
                "attack": round(home.attack, 3), "defence": round(home.defence, 3),
                "attack_home": round(home.attack_home, 3),
                "defence_home": round(home.defence_home, 3),
            },
            "strength_away": {
                "attack": round(away.attack, 3), "defence": round(away.defence, 3),
                "attack_away": round(away.attack_away, 3),
                "defence_away": round(away.defence_away, 3),
            },
            "baseline": {
                "home_avg_goals": baseline.home_avg_goals,
                "away_avg_goals": baseline.away_avg_goals,
                "home_advantage": baseline.home_advantage,
            },
            "confidence_label": confidence.confidence_label(conf),
        }

        matrix = pred.matrix
        matrix_json = None
        if matrix is not None:
            matrix_json = json.dumps(
                [[round(float(matrix[i, j]), 4) for j in range(6)] for i in range(6)]
            )

        db.upsert("predictions", {
            "fixture_id": f.id, "sport": "football", "model": pred.model_version,
            "lambda_home": pred.lam_home, "lambda_away": pred.lam_away,
            "p_home": pred.p_home, "p_draw": pred.p_draw, "p_away": pred.p_away,
            "pick": pred.pick,
            "pick_label": _pick_label(pred.pick),
            "confidence": conf,
            "over_25": pred.over, "btts": pred.btts,
            "top_score": f"{pred.top_score[0]}-{pred.top_score[1]}",
            "top_score_prob": pred.top_score_prob,
            "score_matrix": matrix_json,
            "detail_json": json.dumps(detail, ensure_ascii=False),
            "created_at": now_iso,
            "model_version": pred.model_version,
        }, ["fixture_id"])

        db.upsert("h2h", {
            "fixture_id": f.id, "sport": "football",
            "played": detail["h2h"].get("played", 0) if detail["h2h"] else 0,
            "home_wins": detail["h2h"].get("home_wins", 0) if detail["h2h"] else 0,
            "draws": detail["h2h"].get("draws", 0) if detail["h2h"] else 0,
            "away_wins": detail["h2h"].get("away_wins", 0) if detail["h2h"] else 0,
            "total_goals": detail["h2h"].get("total_goals", 0) if detail["h2h"] else 0,
            "last_json": json.dumps(
                (detail["h2h"] or {}).get("last", [])[:6], ensure_ascii=False
            ),
            "updated_at": now_iso,
        }, ["fixture_id", "sport"])

        # Absents : on repart de zéro pour ce match, puis on reinscrit la liste
        # courante. Sans le DELETE, les blessés des syncs précédents s'accumuleraient.
        db.execute("DELETE FROM injuries WHERE fixture_id = ?", (f.id,))
        for inj in detail["injuries"]:
            db.execute(
                "INSERT INTO injuries "
                "(fixture_id, team_id, sport, player, reason, is_key, updated_at) "
                "VALUES (?, ?, 'football', ?, ?, ?, ?)",
                (f.id, inj["team_id"], inj["player"], inj["reason"],
                 1 if inj["is_key"] else 0, now_iso),
            )

        predicted += 1

    db.execute(
        "UPDATE sync_log SET finished_at=?, ok=1, message=? "
        "WHERE started_at=? AND ok=0",
        (db.utcnow(), f"{len(upcoming)} matchs, {predicted} pronostics", now_iso),
    )
    return {
        "upcoming": len(upcoming),
        "predicted": predicted,
        "finished_analysed": len(finished),
        "teams_with_stats": len(strengths),
    }


# ---------------------------------------------------------------------------
# Sync tennis et basket (démo pour l'instant, moteurs déjà en place)
# ---------------------------------------------------------------------------
def sync_tennis(days_ahead: int = FIXTURE_DAYS_AHEAD) -> dict:
    prov = DemoTennisProvider()
    now_iso = db.utcnow()
    n = 0
    for m in prov.matches(days_ahead):
        a = tennis.PlayerRating(player_id=_tid(m["home"], "tennis"), name=m["home"], elo=m["elo_home"])
        b = tennis.PlayerRating(player_id=_tid(m["away"], "tennis"), name=m["away"], elo=m["elo_away"])
        for p in (a, b):
            db.upsert("teams", {
                "id": p.player_id, "league_id": 0, "name": p.name, "short": "",
                "logo": "", "venue": "", "sport": "tennis", "elo_rating": p.elo,
            }, ["id", "sport"])
        pred = tennis.predict_match(a, b, m["surface"])
        sets = tennis.sets_probability(max(pred["p_home"], pred["p_away"]))
        db.upsert("fixtures", {
            "id": m["id"], "league_id": 0, "sport": "tennis",
            "home_id": a.player_id, "away_id": b.player_id,
            "kickoff_utc": m["kickoff_utc"], "round": m["tournament"],
            "venue": "", "status": "NS", "home_goals": None, "away_goals": None,
            "season": 2026, "source": "demo", "created_at": now_iso, "updated_at": now_iso,
        }, ["id", "sport"])
        db.upsert("predictions", {
            "fixture_id": m["id"], "sport": "tennis", "model": pred["model_version"],
            "lambda_home": pred["elo_home"], "lambda_away": pred["elo_away"],
            "p_home": pred["p_home"], "p_draw": 0.0, "p_away": pred["p_away"],
            "pick": pred["pick"], "pick_label": m["home"] if pred["pick"] == "A" else m["away"],
            "confidence": pred["confidence"], "over_25": None, "btts": None,
            "top_score": None, "top_score_prob": None, "score_matrix": None,
            "detail_json": json.dumps({**pred, **sets, "tournament": m["tournament"]},
                                      ensure_ascii=False),
            "created_at": now_iso, "model_version": pred["model_version"],
        }, ["fixture_id"])
        n += 1
    return {"predicted": n}


def sync_basket(days_ahead: int = FIXTURE_DAYS_AHEAD) -> dict:
    prov = DemoBasketProvider()
    now_iso = db.utcnow()
    ctx = basketball.LeagueContext()
    n = 0
    for m in prov.matches(days_ahead):
        hid, aid = _tid(m["home"], "basket"), _tid(m["away"], "basket")
        for tid, name, off, dfn in (
            (hid, m["home"], m["off_home"], m["def_home"]),
            (aid, m["away"], m["off_away"], m["def_away"]),
        ):
            db.upsert("teams", {
                "id": tid, "league_id": 0, "name": name, "short": "", "logo": "",
                "venue": "", "sport": "basket", "elo_rating": None,
            }, ["id", "sport"])
        home = basketball.HoopsRating(
            team_id=hid, off_home=m["off_home"], def_home=m["def_home"],
            off_away=m["off_home"] * 0.96, def_away=m["def_home"] * 1.04,
            pace=m["pace_home"],
        )
        away = basketball.HoopsRating(
            team_id=aid, off_home=m["off_away"] * 1.04, def_home=m["def_away"] * 0.96,
            off_away=m["off_away"], def_away=m["def_away"], pace=m["pace_away"],
        )
        pred = basketball.predict_match(home, away, ctx)
        db.upsert("fixtures", {
            "id": m["id"], "league_id": 0, "sport": "basket",
            "home_id": hid, "away_id": aid, "kickoff_utc": m["kickoff_utc"],
            "round": "NBA", "venue": "", "status": "NS",
            "home_goals": None, "away_goals": None, "season": 2026,
            "source": "demo", "created_at": now_iso, "updated_at": now_iso,
        }, ["id", "sport"])
        db.upsert("predictions", {
            "fixture_id": m["id"], "sport": "basket", "model": pred["model_version"],
            "lambda_home": pred["lambda_home"], "lambda_away": pred["lambda_away"],
            "p_home": pred["p_home"], "p_draw": 0.0, "p_away": pred["p_away"],
            "pick": pred["pick"], "pick_label": m["home"] if pred["pick"] == "1" else m["away"],
            "confidence": pred["confidence"], "over_25": pred["over_25"], "btts": None,
            "top_score": None, "top_score_prob": None, "score_matrix": None,
            "detail_json": json.dumps(pred, ensure_ascii=False),
            "created_at": now_iso, "model_version": pred["model_version"],
        }, ["fixture_id"])
        n += 1
    return {"predicted": n}


def sync_all(days_ahead: int = FIXTURE_DAYS_AHEAD) -> dict:
    """Point d'entrée appelé par le cron et par le bouton « Synchroniser »."""
    result: dict = {"mode": DATA_MODE}
    provider = get_provider(DATA_MODE, sport="football", league_id=39)
    try:
        result["football"] = sync_football(provider, list(LEAGUES.keys()), days_ahead)
    except Exception as exc:  # on ne bloque pas le reste du sync
        log.exception("sync football en échec")
        result["football"] = {"error": str(exc)}
    finally:
        close = getattr(provider, "close", None)
        if callable(close):
            close()

    try:
        result["tennis"] = sync_tennis(days_ahead)
    except Exception as exc:
        log.exception("sync tennis en échec")
        result["tennis"] = {"error": str(exc)}

    try:
        result["basket"] = sync_basket(days_ahead)
    except Exception as exc:
        log.exception("sync basket en échec")
        result["basket"] = {"error": str(exc)}

    result["finished_at"] = db.utcnow()

    # Les matchs saisis à la main sont recalculés avec les moyennes de ligue
    # affinées par ce sync. Leurs statistiques restent celles de l'utilisateur :
    # seule la référence de la ligue évolue.
    try:
        from .manual import recompute_all_manual
        result["manual_recomputed"] = recompute_all_manual()
    except Exception as exc:
        log.exception("recalcul des matchs saisis en échec")
        result["manual_recomputed"] = f"erreur : {exc}"

    return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _fixture_row(f, now_iso: str, source: str | None = None) -> dict:
    """Ligne `fixtures` prête pour l'upsert.

    `source` identifie l'origine du match pour l'affichage : "apifootball"
    (données réelles), "demo" (championnat fictif) ou "manual" (saisie).
    Sans argument, on se rabat sur le mode de données courant.
    """
    return {
        "id": f.id, "league_id": f.league_id, "sport": f.sport,
        "home_id": f.home_id, "away_id": f.away_id,
        "kickoff_utc": f.kickoff_utc, "round": f.round, "venue": f.venue,
        "status": f.status, "home_goals": f.home_goals, "away_goals": f.away_goals,
        "season": f.season,
        "source": source or getattr(f, "source", None) or DATA_MODE,
        "updated_at": now_iso,
    }


def _pick_label(pick: str) -> str:
    return {"1": "Victoire domicile", "X": "Match nul", "2": "Victoire extérieur"}.get(pick, pick)


def _tid(name: str, sport: str) -> int:
    import hashlib
    return 1000 + int(hashlib.sha256(f"{sport}:{name}".encode()).hexdigest()[:6], 16) % 89000


def _safe_form(provider, team_id: int, league_id: int) -> dict | None:
    try:
        f = provider.fetch_form(team_id, league_id, FORM_WINDOW)
        if f is None:
            return None
        return {
            "form": f.form_string, "points": f.form_points,
            "gf_avg": f.gf_avg, "ga_avg": f.ga_avg, "matches": f.matches,
        }
    except Exception as exc:
        log.debug("forme indisponible pour %s : %s", team_id, exc)
        return None


def _safe_h2h(provider, home_id: int, away_id: int) -> dict | None:
    try:
        h = provider.fetch_h2h(home_id, away_id)
        if h is None:
            return None
        return {
            "played": h.played, "home_wins": h.home_wins, "draws": h.draws,
            "away_wins": h.away_wins, "total_goals": h.total_goals, "last": h.last,
        }
    except Exception as exc:
        log.debug("h2h indisponible : %s", exc)
        return None


def _safe_injuries(provider, fixture_id: int) -> list[dict]:
    try:
        return [
            {"team_id": i.team_id, "player": i.player, "reason": i.reason, "is_key": i.is_key}
            for i in provider.fetch_injuries(fixture_id)
        ]
    except Exception as exc:
        log.debug("blessés indisponibles : %s", exc)
        return []
