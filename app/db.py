"""Couche d'accès à la base SQLite.

Un seul fichier `prono.db`, schéma créé au démarrage, accès thread-safe.
"""

from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterable, Iterator

from .config import DB_PATH

_local = threading.local()

SCHEMA = """
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS leagues (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    country         TEXT,
    sport           TEXT NOT NULL DEFAULT 'football',
    home_avg_goals  REAL,
    away_avg_goals  REAL,
    home_advantage  REAL
);

-- Clé primaire composite (id, sport) : les identifiants d'équipes sont propres
-- à chaque fournisseur, donc un id football peut numeriquement coincider avec
-- un id basket ou tennis. Sans le sport dans la cle, les sports se marcheraient
-- dessus, et l'upsert sur (id, sport) ne correspondrait a aucune contrainte.
CREATE TABLE IF NOT EXISTS teams (
    id          INTEGER NOT NULL,
    league_id   INTEGER,
    name        TEXT NOT NULL,
    short       TEXT,
    logo        TEXT,
    venue       TEXT,
    sport       TEXT NOT NULL DEFAULT 'football',
    elo_rating  REAL,
    PRIMARY KEY (id, sport)
);

-- Meme logique que pour teams : cle primaire composite (id, sport) pour que
-- l'upsert corresponde a une vraie contrainte et que les sports ne se marchent
-- pas dessus sur des identifiants numeriquement identiques.
CREATE TABLE IF NOT EXISTS fixtures (
    id            INTEGER NOT NULL,
    league_id     INTEGER,
    sport         TEXT NOT NULL,
    home_id       INTEGER,
    away_id       INTEGER,
    kickoff_utc   TEXT,
    round         TEXT,
    venue         TEXT,
    status        TEXT DEFAULT 'NS',
    home_goals    INTEGER,
    away_goals    INTEGER,
    season        INTEGER,
    source        TEXT,
    created_at    TEXT,
    updated_at    TEXT,
    PRIMARY KEY (id, sport)
);

CREATE INDEX IF NOT EXISTS idx_fixtures_kickoff ON fixtures (kickoff_utc);
CREATE INDEX IF NOT EXISTS idx_fixtures_league  ON fixtures (league_id, sport);
CREATE INDEX IF NOT EXISTS idx_fixtures_status  ON fixtures (status);

CREATE TABLE IF NOT EXISTS team_stats (
    team_id          INTEGER,
    league_id        INTEGER,
    sport            TEXT,
    season           INTEGER,
    played           INTEGER DEFAULT 0,
    played_home      INTEGER DEFAULT 0,
    played_away      INTEGER DEFAULT 0,
    goals_for        REAL DEFAULT 0,
    goals_against    REAL DEFAULT 0,
    home_gf          REAL DEFAULT 0,
    home_ga          REAL DEFAULT 0,
    away_gf          REAL DEFAULT 0,
    away_ga          REAL DEFAULT 0,
    points           INTEGER DEFAULT 0,
    wins             INTEGER DEFAULT 0,
    draws            INTEGER DEFAULT 0,
    losses           INTEGER DEFAULT 0,
    position         INTEGER,
    attack_strength  REAL,
    defence_strength REAL,
    updated_at       TEXT,
    PRIMARY KEY (team_id, league_id, sport, season)
);

CREATE TABLE IF NOT EXISTS team_form (
    team_id       INTEGER,
    league_id     INTEGER,
    sport         TEXT,
    form_string   TEXT,
    form_points   REAL,
    gf_avg        REAL,
    ga_avg        REAL,
    matches_json  TEXT,
    updated_at    TEXT,
    PRIMARY KEY (team_id, league_id, sport)
);

CREATE TABLE IF NOT EXISTS h2h (
    fixture_id    INTEGER,
    sport         TEXT,
    played        INTEGER,
    home_wins     INTEGER,
    draws         INTEGER,
    away_wins     INTEGER,
    total_goals   REAL,
    last_json     TEXT,
    updated_at    TEXT,
    PRIMARY KEY (fixture_id, sport)
);

CREATE TABLE IF NOT EXISTS injuries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fixture_id  INTEGER,
    team_id     INTEGER,
    sport       TEXT,
    player      TEXT,
    reason      TEXT,
    is_key      INTEGER DEFAULT 0,
    updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS predictions (
    fixture_id     INTEGER PRIMARY KEY,
    sport          TEXT NOT NULL,
    model          TEXT,
    lambda_home    REAL,
    lambda_away    REAL,
    p_home         REAL,
    p_draw         REAL,
    p_away         REAL,
    pick           TEXT,
    pick_label     TEXT,
    confidence     REAL,
    over_25        REAL,
    btts           REAL,
    top_score      TEXT,
    top_score_prob REAL,
    score_matrix   TEXT,
    detail_json    TEXT,
    created_at     TEXT,
    model_version  TEXT
);

CREATE TABLE IF NOT EXISTS prediction_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    fixture_id   INTEGER,
    sport        TEXT,
    pick         TEXT,
    confidence   REAL,
    correct      INTEGER,
    resolved_at  TEXT
);

CREATE TABLE IF NOT EXISTS standings (
    team_id     INTEGER,
    league_id   INTEGER,
    sport       TEXT,
    season      INTEGER,
    position    INTEGER,
    played      INTEGER,
    points      INTEGER,
    goal_diff   INTEGER,
    updated_at  TEXT,
    PRIMARY KEY (team_id, league_id, sport, season)
);

CREATE TABLE IF NOT EXISTS sync_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  TEXT,
    finished_at TEXT,
    mode        TEXT,
    ok          INTEGER,
    message     TEXT
);
"""


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_conn() -> sqlite3.Connection:
    """Une connexion par thread (SQLite n'aime pas être partagé entre threads)."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB_PATH, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 15000")
        _local.conn = conn
    return conn


def init_db() -> None:
    conn = get_conn()
    conn.executescript(SCHEMA)
    conn.commit()


@contextmanager
def tx() -> Iterator[sqlite3.Connection]:
    """Bloc transactionnel : commit si OK, rollback sinon."""
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def query(sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
    return get_conn().execute(sql, tuple(params)).fetchall()


def query_one(sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
    return get_conn().execute(sql, tuple(params)).fetchone()


def execute(sql: str, params: Iterable[Any] = ()) -> int:
    with tx() as conn:
        cur = conn.execute(sql, tuple(params))
        return cur.lastrowid or cur.rowcount


def upsert(table: str, row: dict, key_cols: list[str]) -> None:
    """INSERT ... ON CONFLICT DO UPDATE générique."""
    cols = list(row.keys())
    update_cols = [c for c in cols if c not in key_cols]
    sql = (
        f"INSERT INTO {table} ({', '.join(cols)}) "
        f"VALUES ({', '.join('?' for _ in cols)}) "
        f"ON CONFLICT ({', '.join(key_cols)}) DO UPDATE SET "
        + ", ".join(f"{c} = excluded.{c}" for c in update_cols)
    )
    execute(sql, [row[c] for c in cols])


def reset_db() -> None:
    """Vide toutes les tables (utilisé par les tests)."""
    conn = get_conn()
    tables = [
        "leagues", "teams", "fixtures", "team_stats", "team_form",
        "h2h", "injuries", "predictions", "prediction_log", "standings", "sync_log",
    ]
    with tx():
        for t in tables:
            conn.execute(f"DELETE FROM {t}")
