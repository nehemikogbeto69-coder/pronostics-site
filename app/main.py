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
    API_FOOTBALL_KEY, DATA_MODE, DISCLAIMER, FIXTURE_DAYS_AHEAD, LEAGUES,
    SITE_NAME, SYNC_INTERVAL_MINUTES,
)
from .scheduler import next_run_iso, start_scheduler, stop_scheduler
from .backtest import roi_simulation, run_backtest

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
        "sync_interval_minutes": SYNC_INTERVAL_MINUTES,
        "days_ahead": FIXTURE_DAYS_AHEAD,
        "leagues": leagues,
        "predictions_in_db": counts["n"] if counts else 0,
        "last_sync": dict(last_sync) if last_sync else None,
        "next_sync": next_run_iso(),
        "disclaimer": DISCLAIMER,
    }


# ---------------------------------------------------------------------------
# Matchs et pronostics
# ---------------------------------------------------------------------------
@app.get("/api/matches")
def matches(
    sport: str = Query("football", description="football | tennis | basket"),
    league: int | None = Query(None, description="Identifiant de ligue"),
    days: int = Query(FIXTURE_DAYS_AHEAD, ge=1, le=30),
    min_confidence: float = Query(0.0, ge=0.0, le=100.0),
    limit: int = Query(100, ge=1, le=300),
) -> dict:
    """Matchs à venir avec leur pronostic, du plus proche au plus lointain."""
    sql = """
        SELECT f.id, f.league_id, f.sport, f.home_id, f.away_id, f.kickoff_utc,
               f.round, f.venue, f.status,
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
               f.round, f.venue, f.status,
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
# Backtest
# ---------------------------------------------------------------------------
@app.get("/api/backtest")
def backtest(league_id: int = 39, last_n: int = Query(60, ge=10, le=300)) -> dict:
    """Performance du modèle sur les matchs déjà joués, sans fuite d'information."""
    provider = _make_provider()
    try:
        finished = provider.fetch_finished([league_id], limit=400)
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
