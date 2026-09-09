"""Connecteur API-Football (api-sports.io, v3) — DONNÉES RÉELLES.

Activé automatiquement dès que `API_FOOTBALL_KEY` est défini dans `.env`.

Endpoints utilisés :
    /fixtures                  matchs (à venir et terminés)
    /teams                     équipes d'une ligue
    /fixtures/headtohead       confrontations directes
    /standings                 classement
    /sidelined                 blessés et suspendus

⚠️ Le plan gratuit est limité à ~100 requêtes / jour et 10 requêtes / minute.
   Le sync est donc volontairement économe : il met en cache, regroupe les
   appels et respecte un délai entre chaque requête. Voir SYNC_INTERVAL_MINUTES
   dans config.py pour espacer davantage.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..config import (
    API_FOOTBALL_FREE_SEASONS,
    API_FOOTBALL_HOST,
    API_FOOTBALL_KEY,
    API_FOOTBALL_SEASON,
    FORM_WINDOW,
)
from .base import (
    BaseProvider,
    FixtureDTO,
    FormDTO,
    H2HDTO,
    InjuryDTO,
    TeamDTO,
    TeamStatsDTO,
)

log = logging.getLogger("prono.apifootball")

# Garde-fou anti-quota : délai minimum entre deux appels.
MIN_REQUEST_GAP_S = 6.5


class APIFootballError(RuntimeError):
    pass


class APIFootballProvider(BaseProvider):
    name = "apifootball"
    sport = "football"

    def __init__(self, key: str | None = None, host: str | None = None, timeout: float = 20.0):
        self.key = key or API_FOOTBALL_KEY
        self.host = host or API_FOOTBALL_HOST
        if not self.key:
            raise APIFootballError(
                "API_FOOTBALL_KEY absente. Ajoutez-la dans app/.env ou passez "
                "PRONOLAB_MODE=demo pour utiliser les données de démonstration."
            )
        self._last_call = 0.0
        self._last_team_stats: TeamStatsDTO | None = None
        self._client = httpx.Client(
            base_url=f"https://{self.host}",
            headers={"x-apisports-key": self.key},
            timeout=timeout,
        )
        self._cache: dict[str, Any] = {}

    # ------------------------------------------------------------------
    # Transport
    # ------------------------------------------------------------------
    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_call
        if elapsed < MIN_REQUEST_GAP_S:
            time.sleep(MIN_REQUEST_GAP_S - elapsed)

    def get(self, path: str, **params: Any) -> list[dict]:
        """Appel GET avec gestion des erreurs et du quota."""
        params = {k: v for k, v in params.items() if v is not None}
        cache_key = f"{path}?{sorted(params.items())}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        self._throttle()
        try:
            r = self._client.get(path, params=params)
        except httpx.HTTPError as exc:
            raise APIFootballError(f"Erreur réseau sur {path} : {exc}") from exc
        finally:
            self._last_call = time.monotonic()

        if r.status_code in (429, 402):
            raise APIFootballError(
                f"Quota API dépassé (HTTP {r.status_code}). Espacez les syncs ou "
                f"augmentez SYNC_INTERVAL_MINUTES."
            )
        if r.status_code == 403:
            # 403 = clé absente, invalide, expirée, ou envoyée dans le mauvais
            # en-tête. C'est de loin l'erreur la plus fréquente au démarrage.
            raise APIFootballError(
                "HTTP 403 — clé refusée. Vérifiez que API_FOOTBALL_KEY est bien "
                "définie sur Render, qu'elle ne contient pas d'espace ni de "
                "guillemet, et qu'elle est active sur dashboard.api-football.io."
            )
        if r.status_code >= 400:
            raise APIFootballError(f"HTTP {r.status_code} sur {path} : {r.text[:200]}")

        try:
            body = r.json()
        except ValueError as exc:
            raise APIFootballError(f"Réponse non-JSON sur {path}") from exc

        if body.get("errors"):
            errs = body["errors"]
            # Le refus de saison est l'erreur la plus fréquente en plan gratuit :
            # on la traduit en instruction actionnable plutôt qu'en dict brut.
            texte = str(errs)
            if "plan" in errs if isinstance(errs, dict) else "plan" in texte:
                saisons = ", ".join(str(s) for s in API_FOOTBALL_FREE_SEASONS)
                raise APIFootballError(
                    f"accès refusé par le plan : {texte}. Le plan gratuit ne "
                    f"couvre que les saisons {saisons}. Réglez "
                    f"API_FOOTBALL_SEASON sur l'une d'elles (2023 par défaut), "
                    f"ou passez sur un plan payant pour la saison en cours."
                )
            raise APIFootballError(f"API-Football : {texte}")

        data = body.get("response", [])
        self._cache[cache_key] = data
        return data

    def health_check(self) -> tuple[bool, str]:
        """Vérifie la clé et l'état du compte.

        Ne lève jamais d'exception : `/api/health` doit répondre même quand
        l'API est injoignable ou quand la clé est refusée. Le message retourné
        est destiné à être lu dans les logs de déploiement.

        ⚠️ `response` n'est pas toujours une liste. Selon l'état du compte,
        API-Football peut renvoyer un objet, une chaîne, voire une liste de
        chaînes. Un `data[0]` aveugle sur un dict lève `KeyError: 0` — c'est
        exactement le plantage observé sur Render.
        """
        try:
            data = self.get("/status")
        except APIFootballError as exc:
            return False, f"API-Football : {exc}"
        except Exception as exc:  # réseau, DNS, timeout, JSON inattendu
            return False, f"source injoignable : {type(exc).__name__}: {exc}"

        try:
            info = _first_dict(data)
        except Exception as exc:
            return False, f"réponse /status illisible : {type(exc).__name__}"

        if info is None:
            return True, (
                "API-Football répond, mais /status ne renvoie pas les infos de "
                f"compte attendues (type reçu : {type(data).__name__})"
            )

        acc = info.get("account")
        if not isinstance(acc, dict):
            return True, "API-Football répond, mais aucune info de compte dans /status"

        subscription = acc.get("subscription") or "inconnue"
        req = info.get("requests") if isinstance(info.get("requests"), dict) else {}
        current, limit_day = req.get("current"), req.get("limit_day")

        nom = " ".join(
            part for part in (acc.get("firstname"), acc.get("lastname")) if part
        ).strip() or acc.get("email", "compte")

        if current is not None and limit_day:
            quota = f" — requêtes aujourd'hui : {current}/{limit_day}"
            if current >= limit_day:
                return False, (
                    f"quota journalier épuisé ({current}/{limit_day}). "
                    "Attendez la réinitialisation ou augmentez PRONOLAB_SYNC_MINUTES."
                )
        else:
            quota = ""

        return True, f"clé valide — compte {nom}, offre {subscription}{quota}"

    def list_seasons(self, league_id: int) -> list[dict]:
        """Saisons disponibles pour une ligue.

        Coûte 1 requête. Permet de vérifier quelles saisons votre plan autorise
        avant de régler API_FOOTBALL_SEASON.
        """
        rows = self.get("/fixtures/seasons", league=league_id)
        out = []
        for r in rows:
            if isinstance(r, dict):
                out.append({
                    "season": r.get("season"),
                    "start": r.get("start"),
                    "end": r.get("end"),
                    "current": bool(r.get("current")),
                })
        return out

    # ------------------------------------------------------------------
    # Matchs
    # ------------------------------------------------------------------
    def fetch_upcoming(self, league_ids: list[int], days_ahead: int) -> list[FixtureDTO]:
        out: list[FixtureDTO] = []
        now = datetime.now(timezone.utc)
        for lid in league_ids:
            for day in range(days_ahead + 1):
                d = (now + timedelta(days=day)).date().isoformat()
                try:
                    rows = self.get("/fixtures", league=lid, season=_season(), date=d)
                except APIFootballError as exc:
                    log.warning("fixtures %s %s : %s", lid, d, exc)
                    continue
                out.extend(self._to_fixture(r) for r in rows)
        return _dedupe(out)

    def fetch_finished(self, league_ids: list[int], limit: int = 200) -> list[FixtureDTO]:
        out: list[FixtureDTO] = []
        for lid in league_ids:
            rows = self.get(
                "/fixtures", league=lid, season=_season(), last=min(limit, 100),
            )
            out.extend(self._to_fixture(r) for r in rows)
        return _dedupe(out)[:limit]

    @staticmethod
    def _to_fixture(row: dict) -> FixtureDTO:
        fx = row.get("fixture", {})
        lg = row.get("league", {})
        teams = row.get("teams", {})
        goals = row.get("goals", {})
        return FixtureDTO(
            id=int(fx.get("id")),
            league_id=int(lg.get("id", 0)),
            home_id=int(teams.get("home", {}).get("id", 0)),
            away_id=int(teams.get("away", {}).get("id", 0)),
            kickoff_utc=(fx.get("date") or "").replace("Z", "+00:00"),
            round=fx.get("round", "") or "",
            venue=fx.get("venue", {}).get("name", "") or "",
            status=(fx.get("status", {}).get("short") or "NS"),
            home_goals=goals.get("home"),
            away_goals=goals.get("away"),
            season=int(lg.get("season", 0) or 0),
            sport="football",
        )

    # ------------------------------------------------------------------
    # Équipes, forme, H2H, blessés, classement
    # ------------------------------------------------------------------
    def fetch_teams(self, league_id: int) -> list[TeamDTO]:
        rows = self.get("/teams", league=league_id, season=_season())
        out = []
        for r in rows:
            t = r.get("team", {})
            v = r.get("venue", {})
            out.append(TeamDTO(
                id=int(t.get("id")),
                name=t.get("name", ""),
                short=t.get("code", "") or "",
                logo=t.get("logo", "") or "",
                venue=v.get("name", "") or "",
                league_id=league_id,
                sport="football",
            ))
        return out

    def fetch_form(self, team_id: int, league_id: int, last: int = FORM_WINDOW) -> FormDTO | None:
        """Forme récente. Les stats détaillées sont mises en cache au passage
        (`last_team_stats`) puisque `/teams/statistics` renvoie les deux."""
        rows = self.get("/teams/statistics", team=team_id, league=league_id, season=_season())
        if not rows:
            return None
        s = rows[0]
        form_str = (s.get("form") or "")[-last:]
        stats = self._parse_team_stats(s, team_id, league_id)
        self._last_team_stats = stats

        return FormDTO(
            team_id=team_id, league_id=league_id,
            form_string=form_str,
            form_points=_form_points(form_str),
            gf_avg=round(stats.goals_for / max(stats.played, 1), 2),
            ga_avg=round(stats.goals_against / max(stats.played, 1), 2),
            matches=[], sport="football",
        )

    def _parse_team_stats(self, s: dict, team_id: int, league_id: int) -> TeamStatsDTO:
        """Transforme la réponse brute de /teams/statistics en DTO."""
        fx = s.get("fixtures", {}) or {}
        plays = fx.get("plays", {}) or {}
        gf = s.get("goals", {}).get("for", {}) or {}
        ga = s.get("goals", {}).get("against", {}) or {}
        st = TeamStatsDTO(
            team_id=team_id, league_id=league_id, season=_season(),
            played=int(fx.get("played", 0) or 0),
            played_home=int(plays.get("home", 0) or 0),
            played_away=int(plays.get("away", 0) or 0),
            goals_for=_num(gf.get("total")),
            goals_against=_num(ga.get("total")),
            home_gf=_num(gf.get("home")),
            home_ga=_num(ga.get("home")),
            away_gf=_num(gf.get("away")),
            away_ga=_num(ga.get("away")),
            wins=int(_num((s.get("wins") or {}).get("total"))),
            draws=int(_num((s.get("draws") or {}).get("total"))),
            losses=int(_num((s.get("loses") or {}).get("total"))),
        )
        st.points = st.wins * 3 + st.draws
        return st

    def fetch_h2h(self, home_id: int, away_id: int, limit: int = 10) -> H2HDTO | None:
        rows = self.get(
            "/fixtures/headtohead",
            h2h=f"{home_id}-{away_id}", last=limit, timezone="UTC",
        )
        if not rows:
            return None
        hw = dw = aw = 0
        goals = 0.0
        last = []
        for r in rows:
            g = r.get("goals", {})
            hg, ag = g.get("home"), g.get("away")
            if hg is None or ag is None:
                continue
            hg, ag = int(hg), int(ag)
            goals += hg + ag
            res = "1" if hg > ag else ("X" if hg == ag else "2")
            if res == "1":
                hw += 1
            elif res == "X":
                dw += 1
            else:
                aw += 1
            t = r.get("teams", {})
            last.append({
                "date": (r.get("fixture", {}).get("date") or "")[:10],
                "home": t.get("home", {}).get("name", ""),
                "away": t.get("away", {}).get("name", ""),
                "score": f"{hg}-{ag}",
                "result": res,
            })
        played = hw + dw + aw
        return H2HDTO(
            fixture_id=0, played=played, home_wins=hw, draws=dw, away_wins=aw,
            total_goals=round(goals / max(played, 1), 2), last=last, sport="football",
        )

    def fetch_injuries(self, fixture_id: int) -> list[InjuryDTO]:
        try:
            rows = self.get("/sidelined", fixture=fixture_id)
        except APIFootballError as exc:
            log.warning("sidelined %s : %s", fixture_id, exc)
            return []
        out = []
        for r in rows:
            p = r.get("player", {})
            t = r.get("team", {})
            out.append(InjuryDTO(
                fixture_id=fixture_id,
                team_id=int(t.get("id", 0) or 0),
                player=p.get("name", "Inconnu"),
                reason=p.get("type", "") or "",
                is_key=bool(p.get("important", False)),
                sport="football",
            ))
        return out

    def fetch_standings(self, league_id: int, season: int) -> list[dict]:
        rows = self.get("/standings", league=league_id, season=season or _season())
        if not rows:
            return []
        out = []
        for group in rows[0].get("league", {}).get("standings", []):
            for row in group:
                out.append({
                    "team_id": int(row.get("team", {}).get("id", 0)),
                    "position": int(row.get("rank", 0) or 0),
                    "played": int(row.get("all", {}).get("played", 0) or 0),
                    "points": int(row.get("points", 0) or 0),
                    "goal_diff": int(row.get("goalsDiff", 0) or 0),
                })
        return out

    def fetch_team_stats(self, team_id: int, league_id: int) -> TeamStatsDTO | None:
        """Stats détaillées d'une équipe — base du calcul des forces."""
        rows = self.get("/teams/statistics", team=team_id, league=league_id, season=_season())
        if not rows:
            return None
        return self._parse_team_stats(rows[0], team_id, league_id)

    def close(self) -> None:
        self._client.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _first_dict(data: object) -> dict | None:
    """Extrait le premier dictionnaire d'une réponse API, quelle que soit sa forme.

    API-Football renvoie `response` sous forme de liste dans le cas nominal,
    mais un objet seul, une chaîne ou une liste de chaînes sont possibles selon
    l'état du compte. Cette fonction normalise sans jamais lever d'exception de
    type : elle retourne None quand rien d'exploitable n'est trouvé.
    """
    if isinstance(data, dict):
        return data or None
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                return item
        return None
    return None


def _season() -> int:
    """Saison à interroger.

    Utilise API_FOOTBALL_SEASON si elle est définie, sinon la saison courante
    (en Europe, la saison n commence en août de l'année n).

    Le plan gratuit d'API-Football étant limité aux saisons 2022-2024, la
    configuration par défaut vise 2023 : cela permet de travailler sur des
    données réelles sans abonnement payant.
    """
    if API_FOOTBALL_SEASON is not None:
        return API_FOOTBALL_SEASON
    now = datetime.now(timezone.utc)
    return now.year if now.month >= 7 else now.year - 1


def _num(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _form_points(form: str) -> float:
    return sum(3 if c == "W" else (1 if c == "D" else 0) for c in form.upper())


def _dedupe(fixtures: list[FixtureDTO]) -> list[FixtureDTO]:
    seen: dict[int, FixtureDTO] = {}
    for f in fixtures:
        seen[f.id] = f
    return list(seen.values())
