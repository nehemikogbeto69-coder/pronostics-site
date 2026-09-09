"""API FastAPI de PronoLab.

Sert à la fois l'API JSON et le frontend statique.
"""

from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db, sync
from .config import (
    API_FOOTBALL_FREE_SEASONS, API_FOOTBALL_KEY, API_FOOTBALL_SEASON,
    DATA_MODE, DISCLAIMER, FIXTURE_DAYS_AHEAD, LEAGUES,
    SITE_NAME, SYNC_INTERVAL_MINUTES,
)
from .scheduler import next_run_iso, start_scheduler, stop_scheduler
from . import manual
from .backtest import roi_simulation, run_backtest
from .models import confidence

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger("prono.api")

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    _seed_leagues()
    # Le sync initial est lancé par le planificateur, en arrière-plan.
    start_scheduler(run_now=True)
    log.info("PronoLab prêt — mode de données : %s", DATA_MODE)
    yield
    stop_scheduler()


def _seed_leagues() -> None:
    """Garantit que les ligues configurées existent en base."""
    for lid, cfg in LEAGUES.items():
        db.upsert("leagues", {
            "id": lid, "name": cfg["name"], "country": cfg["country"],
            "sport": cfg["sport"],
            "home_avg_goals": cfg["home_avg_goals"],
            "away_avg_goals": cfg["away_avg_goals"],
            "home_advantage": cfg["home_advantage"],
        }, ["id"])


app = FastAPI(
    title=f"{SITE_NAME} API",
    description="Pronostics sportifs algorithmiques — Poisson, Elo, points attendus.",
    version="1.0.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Métadonnées
# ---------------------------------------------------------------------------
@app.get("/api/meta")
def meta() -> dict:
    """État du site : mode de données, ligues, prochaine synchronisation."""
    leagues = [
        {"id": r["id"], "name": r["name"], "country": r["country"],
         "home_avg_goals": r["home_avg_goals"], "away_avg_goals": r["away_avg_goals"]}
        for r in db.query("SELECT * FROM leagues ORDER BY name")
    ]
    last_sync = db.query_one(
        "SELECT * FROM sync_log ORDER BY id DESC LIMIT 1"
    )
    counts = db.query_one(
        "SELECT COUNT(*) AS n FROM predictions"
    )
    return {
        "site_name": SITE_NAME,
        "data_mode": DATA_MODE,
        "demo": DATA_MODE != "apifootball",
        "has_api_key": bool(API_FOOTBALL_KEY),
        "season": API_FOOTBALL_SEASON,
        "season_is_historical": API_FOOTBALL_SEASON is not None,
        "free_seasons": list(API_FOOTBALL_FREE_SEASONS),
        "sync_interval_minutes": SYNC_INTERVAL_MINUTES,
        "days_ahead": FIXTURE_DAYS_AHEAD,
        "leagues": leagues,
        "predictions_in_db": counts["n"] if counts else 0,
        "last_sync": dict(last_sync) if last_sync else None,
        "next_sync": next_run_iso(),
        "disclaimer": DISCLAIMER,
    }


@app.get("/api/seasons/{league_id}")
def seasons(league_id: int) -> dict:
    """Saisons que votre plan autorise pour une ligue (1 requête API).

    Utile avant de régler API_FOOTBALL_SEASON. Réservé au mode données réelles.
    """
    if DATA_MODE == "apifootball":
        provider = _make_provider()
        try:
            rows = provider.list_seasons(league_id)
        except Exception as exc:
            raise HTTPException(502, f"API-Football : {exc}") from exc
        finally:
            close = getattr(provider, "close", None)
            if callable(close):
                close()
    else:
        rows = [
            {"season": s, "start": None, "end": None, "current": False}
            for s in (2022, 2023, 2024, 2025, 2026)
        ]

    league = db.query_one("SELECT * FROM leagues WHERE id = ?", (league_id,))
    return {
        "league": dict(league) if league else {"id": league_id},
        "configured_season": API_FOOTBALL_SEASON,
        "free_seasons": list(API_FOOTBALL_FREE_SEASONS),
        "seasons": rows,
    }


# ---------------------------------------------------------------------------
# Matchs et pronostics
# ---------------------------------------------------------------------------
@app.get("/api/matches")
def matches(
    sport: str = Query("football", description="football | tennis | basket"),
    league: int | None = Query(None, description="Identifiant de ligue"),
    days: int = Query(
        FIXTURE_DAYS_AHEAD, ge=1, le=90,
        description="Fenêtre en jours. Au-delà de 30, seuls les matchs saisis "
                    "manuellement ou issus d'un sync long apparaissent.",
    ),
    min_confidence: float = Query(0.0, ge=0.0, le=100.0),
    source: str | None = Query(
        None,
        description="Filtrer par provenance : manual, demo, apifootball, ou 'api' "
                    "pour tout ce qui n'est pas une saisie manuelle.",
    ),
    limit: int = Query(100, ge=1, le=300),
) -> dict:
    """Matchs à venir avec leur pronostic, du plus proche au plus lointain."""
    sql = """
        SELECT f.id, f.league_id, f.sport, f.home_id, f.away_id, f.kickoff_utc,
               f.round, f.venue, f.status, f.source,
               th.name AS home_name, th.short AS home_short, th.logo AS home_logo,
               ta.name AS away_name, ta.short AS away_short, ta.logo AS away_logo,
               l.name  AS league_name, l.country AS league_country,
               p.model, p.lambda_home, p.lambda_away,
               p.p_home, p.p_draw, p.p_away, p.pick, p.pick_label, p.confidence,
               p.over_25, p.btts, p.top_score, p.top_score_prob,
               p.score_matrix, p.detail_json, p.created_at
        FROM fixtures f
        JOIN predictions p ON p.fixture_id = f.id
        LEFT JOIN teams th ON th.id = f.home_id AND th.sport = f.sport
        LEFT JOIN teams ta ON ta.id = f.away_id AND ta.sport = f.sport
        LEFT JOIN leagues l ON l.id = f.league_id
        WHERE f.sport = ?
          AND f.kickoff_utc >= datetime('now')
          AND f.kickoff_utc <= datetime('now', ?)
    """
    params: list = [sport, f"+{days} days"]
    if league is not None:
        sql += " AND f.league_id = ?"
        params.append(league)
    if min_confidence > 0:
        sql += " AND p.confidence >= ?"
        params.append(min_confidence)
    if source:
        # "api" regroupe tout ce qui vient d'une source automatique, pour
        # séparer d'un coup les données réelles/démo des saisies manuelles.
        if source == "api":
            sql += " AND COALESCE(f.source, '') != 'manual'"
        else:
            sql += " AND f.source = ?"
            params.append(source)
    sql += " ORDER BY f.kickoff_utc ASC LIMIT ?"
    params.append(limit)

    rows = db.query(sql, params)
    items = [_row_to_match(r) for r in rows]
    return {
        "sport": sport,
        "count": len(items),
        "days": days,
        "data_mode": DATA_MODE,
        "matches": items,
    }


SOURCE_LABELS = {
    "manual": ("Saisie manuelle", "manual"),
    "demo": ("Démo", "demo"),
    "demo-tennis": ("Démo", "demo"),
    "demo-basket": ("Démo", "demo"),
    "apifootball": ("API", "api"),
}


def _source_info(raw) -> dict:
    """Provenance d'un match, prête à afficher.

    Trois catégories seulement côté interface : api, demo, manual. Le détail
    technique reste disponible dans `raw`.
    """
    label, kind = SOURCE_LABELS.get(raw or "", (raw or "inconnue", "demo"))
    return {"raw": raw, "label": label, "kind": kind}


def _row_to_match(r) -> dict:
    detail = {}
    if r["detail_json"]:
        try:
            detail = json.loads(r["detail_json"])
        except json.JSONDecodeError:
            detail = {}
    matrix = None
    if r["score_matrix"]:
        try:
            matrix = json.loads(r["score_matrix"])
        except json.JSONDecodeError:
            matrix = None
    return {
        "id": r["id"],
        "source": _source_info(r["source"]),
        "league": {"id": r["league_id"], "name": r["league_name"] or "",
                   "country": r["league_country"] or ""},
        "kickoff_utc": r["kickoff_utc"],
        "round": r["round"] or "",
        "venue": r["venue"] or "",
        "home": {"id": r["home_id"], "name": r["home_name"] or "?",
                 "short": r["home_short"] or "", "logo": r["home_logo"] or ""},
        "away": {"id": r["away_id"], "name": r["away_name"] or "?",
                 "short": r["away_short"] or "", "logo": r["away_logo"] or ""},
        "prediction": {
            "model": r["model"],
            "lambda_home": r["lambda_home"],
            "lambda_away": r["lambda_away"],
            "p_home": r["p_home"], "p_draw": r["p_draw"], "p_away": r["p_away"],
            "pick": r["pick"], "pick_label": r["pick_label"],
            "confidence": r["confidence"],
            "over_25": r["over_25"], "btts": r["btts"],
            "top_score": r["top_score"], "top_score_prob": r["top_score_prob"],
            "created_at": r["created_at"],
        },
        "matrix": matrix,
        "detail": detail,
    }


@app.get("/api/match/{fixture_id}")
def match_detail(fixture_id: int) -> dict:
    """Détail complet d'un match : stats, forces, forme, H2H, blessés, matrice."""
    r = db.query_one(
        """
        SELECT f.id, f.league_id, f.sport, f.home_id, f.away_id, f.kickoff_utc,
               f.round, f.venue, f.status, f.source,
               th.name AS home_name, th.short AS home_short, th.logo AS home_logo,
               ta.name AS away_name, ta.short AS away_short, ta.logo AS away_logo,
               l.name  AS league_name, l.country AS league_country,
               p.model, p.lambda_home, p.lambda_away,
               p.p_home, p.p_draw, p.p_away, p.pick, p.pick_label, p.confidence,
               p.over_25, p.btts, p.top_score, p.top_score_prob,
               p.score_matrix, p.detail_json, p.created_at
        FROM fixtures f
        JOIN predictions p ON p.fixture_id = f.id
        LEFT JOIN teams th ON th.id = f.home_id AND th.sport = f.sport
        LEFT JOIN teams ta ON ta.id = f.away_id AND ta.sport = f.sport
        LEFT JOIN leagues l ON l.id = f.league_id
        WHERE f.id = ?
        """,
        (fixture_id,),
    )
    if r is None:
        raise HTTPException(404, "Match introuvable ou sans pronostic")

    stats_home = db.query_one(
        "SELECT * FROM team_stats WHERE team_id = ? ORDER BY season DESC LIMIT 1",
        (r["home_id"],),
    )
    stats_away = db.query_one(
        "SELECT * FROM team_stats WHERE team_id = ? ORDER BY season DESC LIMIT 1",
        (r["away_id"],),
    )
    injuries = db.query("SELECT * FROM injuries WHERE fixture_id = ?", (fixture_id,))
    h2h = db.query_one(
        "SELECT * FROM h2h WHERE fixture_id = ? AND sport = 'football'", (fixture_id,)
    )

    base = _row_to_match(r)
    base["stats_home"] = dict(stats_home) if stats_home else None
    base["stats_away"] = dict(stats_away) if stats_away else None
    base["injuries"] = [dict(i) for i in injuries]
    if h2h and h2h["last_json"]:
        try:
            base["h2h_matches"] = json.loads(h2h["last_json"])
        except json.JSONDecodeError:
            base["h2h_matches"] = []
    return base


# ---------------------------------------------------------------------------
# Classement
# ---------------------------------------------------------------------------
@app.get("/api/standings/{league_id}")
def standings(league_id: int) -> dict:
    """Classement dérivé des résultats stockés."""
    rows = db.query(
        """
        SELECT t.id, t.name, t.short, s.position, s.played, s.points,
               s.wins, s.draws, s.losses,
               s.goals_for, s.goals_against,
               s.attack_strength, s.defence_strength
        FROM team_stats s
        JOIN teams t ON t.id = s.team_id
        WHERE s.league_id = ?
        ORDER BY s.position ASC
        """,
        (league_id,),
    )
    league = db.query_one("SELECT * FROM leagues WHERE id = ?", (league_id,))
    out = []
    for r in rows:
        d = dict(r)
        d["goal_diff"] = (r["goals_for"] or 0) - (r["goals_against"] or 0)
        out.append(d)
    return {
        "league": dict(league) if league else {"id": league_id},
        "teams": out,
    }


# ---------------------------------------------------------------------------
# Saisie manuelle
# ---------------------------------------------------------------------------
@app.post("/api/manual-matches", status_code=201)
def create_manual_match(payload: dict) -> dict:
    """Ajoute un match saisi à la main et calcule son pronostic.

    Le match passe par le même moteur de Poisson que les matchs issus de l'API :
    seules les statistiques d'entrée diffèrent, puisqu'elles sont fournies ici
    au lieu d'être téléchargées.

    Champs attendus :
      home_name, away_name      noms des deux équipes
      kickoff_utc               date et heure, ex. "2026-09-20T15:00"
      league_id                 identifiant de ligue (voir /api/meta)
      round, venue              facultatifs
      home_gf_home, home_ga_home, home_n_home
      home_gf_away, home_ga_away, home_n_away
      away_gf_home, away_ga_home, away_n_home
      away_gf_away, away_ga_away, away_n_away

    Les buts sont des TOTAUX sur `n` matchs, pas des moyennes.
    """
    try:
        created = manual.create_manual_match(payload)
    except manual.ManualMatchError as exc:
        raise HTTPException(422, str(exc)) from exc

    detail = match_detail(created["fixture_id"])
    return {"created": True, "fixture_id": created["fixture_id"], "match": detail}


@app.get("/api/manual-matches")
def list_manual_matches(include_past: bool = Query(False)) -> dict:
    """Liste les matchs saisis à la main, avec leurs statistiques d'entrée."""
    sql = """
        SELECT m.*, p.pick, p.pick_label, p.confidence,
               p.lambda_home, p.lambda_away, p.created_at AS predicted_at
        FROM manual_matches m
        LEFT JOIN predictions p ON p.fixture_id = m.fixture_id
    """
    if not include_past:
        sql += " WHERE m.kickoff_utc >= datetime('now')"
    sql += " ORDER BY m.kickoff_utc ASC"

    rows = db.query(sql)
    items = []
    for r in rows:
        d = dict(r)
        d["stats"] = {
            "home": {
                "gf_home": r["home_gf_home"], "ga_home": r["home_ga_home"],
                "n_home": r["home_n_home"],
                "gf_away": r["home_gf_away"], "ga_away": r["home_ga_away"],
                "n_away": r["home_n_away"],
            },
            "away": {
                "gf_home": r["away_gf_home"], "ga_home": r["away_ga_home"],
                "n_home": r["away_n_home"],
                "gf_away": r["away_gf_away"], "ga_away": r["away_ga_away"],
                "n_away": r["away_n_away"],
            },
        }
        for k in list(d.keys()):
            if k.startswith(("home_", "away_")) and k not in ("home_name", "away_name"):
                d.pop(k, None)
        items.append(d)
    return {"count": len(items), "matches": items}


@app.delete("/api/manual-matches/{fixture_id}")
def delete_manual_match(fixture_id: int) -> dict:
    """Supprime un match saisi à la main."""
    if not manual.delete_manual_match(fixture_id):
        raise HTTPException(404, "Ce match n'existe pas ou n'est pas une saisie manuelle.")
    return {"deleted": True, "fixture_id": fixture_id}


# ---------------------------------------------------------------------------
# Backtest
# ---------------------------------------------------------------------------
@app.get("/api/results")
def results(
    league_id: int = 39,
    last_n: int = Query(20, ge=1, le=100),
) -> dict:
    """Le modèle rejoué sur des matchs déjà joués.

    C'est l'écran utile quand on travaille sur une saison passée : il n'y a
    aucun match à venir, mais on peut vérifier ce que le modèle aurait annoncé
    sur des résultats connus. Les forces sont recalculées sans le match testé.
    """
    if DATA_MODE != "apifootball":
        provider = _make_provider()
    else:
        provider = _make_provider()

    try:
        finished = provider.fetch_finished([league_id], limit=400)
    except Exception as exc:
        raise HTTPException(502, f"source de données : {exc}") from exc
    finally:
        close = getattr(provider, "close", None)
        if callable(close):
            close()

    rows = _replay(finished, league_id, last_n)
    bt = run_backtest(finished, league_id, last_n=last_n)
    league = db.query_one("SELECT * FROM leagues WHERE id = ?", (league_id,))

    return {
        "league": dict(league) if league else {"id": league_id},
        "season": API_FOOTBALL_SEASON,
        "data_mode": DATA_MODE,
        "count": len(rows),
        "accuracy": round(bt.accuracy, 4) if bt.n_matches else None,
        "baseline_accuracy": round(bt.baseline_accuracy, 4) if bt.n_matches else None,
        "matches": rows,
    }


def _replay(finished: list, league_id: int, last_n: int) -> list[dict]:
    """Recalcule le pronostic de chaque match joué, puis le compare au résultat."""
    from .models import football as fb
    from .sync import baseline_for, compute_team_stats, league_averages

    played = [
        f for f in finished
        if f.league_id == league_id
        and f.home_goals is not None and f.away_goals is not None
    ]
    played.sort(key=lambda f: f.kickoff_utc)
    if not played:
        return []

    # Noms d'équipes, si présents en base.
    names = {r["id"]: r["name"] for r in db.query("SELECT id, name FROM teams")}

    out = []
    for target in played[-last_n:]:
        history = [f for f in played if f.kickoff_utc < target.kickoff_utc]
        if len(history) < 5:
            continue
        averages = league_averages(history)
        baseline = baseline_for(league_id, averages)
        stats = compute_team_stats(history, league_id)
        sh, sa = stats.get(target.home_id), stats.get(target.away_id)
        if not sh or not sa or sh["played"] < 2 or sa["played"] < 2:
            continue

        hs = fb.compute_strength(
            sh["home_gf"], sh["home_ga"], sh["played_home"],
            sh["away_gf"], sh["away_ga"], sh["played_away"], baseline,
        )
        as_ = fb.compute_strength(
            sa["home_gf"], sa["home_ga"], sa["played_home"],
            sa["away_gf"], sa["away_ga"], sa["played_away"], baseline,
        )
        pred = fb.predict_match(hs, as_, baseline)

        hg, ag = int(target.home_goals), int(target.away_goals)
        actual = "1" if hg > ag else ("2" if ag > hg else "X")
        conf = confidence.confidence([pred.p_home, pred.p_draw, pred.p_away])

        out.append({
            "date": target.kickoff_utc[:10],
            "home": names.get(target.home_id, f"Équipe {target.home_id}"),
            "away": names.get(target.away_id, f"Équipe {target.away_id}"),
            "score": f"{hg}-{ag}",
            "actual": actual,
            "lambda_home": pred.lam_home,
            "lambda_away": pred.lam_away,
            "p_home": pred.p_home,
            "p_draw": pred.p_draw,
            "p_away": pred.p_away,
            "pick": pred.pick,
            "confidence": conf,
            "hit": pred.pick == actual,
            "top_score": f"{pred.top_score[0]}-{pred.top_score[1]}",
            "score_hit": f"{pred.top_score[0]}-{pred.top_score[1]}" == f"{hg}-{ag}",
        })

    out.reverse()  # plus récent en premier
    return out


@app.get("/api/backtest")
def backtest(league_id: int = 39, last_n: int = Query(60, ge=10, le=300)) -> dict:
    """Performance du modèle sur les matchs déjà joués, sans fuite d'information."""
    provider = _make_provider()
    try:
        finished = provider.fetch_finished([league_id], limit=400)
    except Exception as exc:
        raise HTTPException(502, f"source de données : {exc}") from exc
    finally:
        close = getattr(provider, "close", None)
        if callable(close):
            close()

    bt = run_backtest(finished, league_id, last_n=last_n)
    roi = roi_simulation(finished, league_id, last_n=last_n)
    league = db.query_one("SELECT * FROM leagues WHERE id = ?", (league_id,))
    return {
        "league": dict(league) if league else {"id": league_id},
        "evaluated_on": last_n,
        "season": API_FOOTBALL_SEASON,
        "data_mode": DATA_MODE,
        **bt.summary(),
        "roi": roi,
    }


def _make_provider():
    from .providers import get_provider
    return get_provider(DATA_MODE, sport="football", league_id=39)


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------
@app.post("/api/sync")
def trigger_sync(days: int = Query(FIXTURE_DAYS_AHEAD, ge=1, le=30)) -> dict:
    """Déclenche une synchronisation immédiate (équivalent du cron)."""
    log.info("sync manuelle demandée (%s jours)", days)
    result = sync.sync_all(days_ahead=days)
    return result


@app.get("/api/health")
def health() -> JSONResponse:
    """État de la source de données et de la base."""
    provider = _make_provider()
    try:
        ok, msg = provider.health_check()
    finally:
        close = getattr(provider, "close", None)
        if callable(close):
            close()

    counts = db.query_one(
        """
        SELECT (SELECT COUNT(*) FROM fixtures)  AS fixtures,
               (SELECT COUNT(*) FROM predictions) AS predictions,
               (SELECT COUNT(*) FROM teams)      AS teams,
               (SELECT COUNT(*) FROM team_stats) AS team_stats
        """
    )
    status = 200 if ok else 503
    return JSONResponse(
        status_code=status,
        content={
            "status": "ok" if ok else "degraded",
            "data_mode": DATA_MODE,
            "provider": provider.name,
            "provider_message": msg,
            "next_sync": next_run_iso(),
            "db": dict(counts) if counts else {},
        },
    )


# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def index() -> FileResponse:
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(500, "Frontend introuvable : static/index.html")
    return FileResponse(str(index_file))
