"""Source de données de DÉMONSTRATION — données 100 % synthétiques.

⚠️  CES CHIFFRES NE SONT PAS RÉELS. Ils servent uniquement à faire tourner
    l'ensemble du pipeline (récupération → stats → Poisson → affichage) avant
    que vous n'ayez une clé API-Football. Dès qu'une clé est présente dans
    `.env`, `PRONOLAB_MODE` bascule sur `apifootball` et ce fichier n'est
    plus utilisé.

Le générateur simule une saison complète de Premier League à partir de forces
d'équipes plausibles, puis en déduit TOUTES les statistiques exactement comme
le ferait la vraie source. Les pronos produits sont donc mathématiquement
corrects — mais appliqués à un championnat fictif.
"""

from __future__ import annotations

import hashlib
import random
from datetime import datetime, timedelta, timezone

from ..config import FORM_WINDOW
from .base import (
    BaseProvider,
    FixtureDTO,
    FormDTO,
    H2HDTO,
    InjuryDTO,
    TeamDTO,
    TeamStatsDTO,
)

# (nom, court, force d'attaque, force de défense — >1 = meilleur que la moyenne)
PREMIER_LEAGUE: list[tuple[str, str, float, float]] = [
    ("Manchester City", "MCI", 1.42, 0.72),
    ("Arsenal", "ARS", 1.34, 0.74),
    ("Liverpool", "LIV", 1.36, 0.78),
    ("Chelsea", "CHE", 1.18, 0.92),
    ("Tottenham", "TOT", 1.16, 0.98),
    ("Manchester United", "MUN", 1.02, 1.02),
    ("Newcastle", "NEW", 1.12, 0.90),
    ("Aston Villa", "AVL", 1.10, 0.96),
    ("Brighton", "BHA", 1.06, 0.98),
    ("West Ham", "WHU", 0.96, 1.04),
    ("Brentford", "BRE", 1.00, 1.02),
    ("Fulham", "FUL", 0.96, 1.00),
    ("Crystal Palace", "CRY", 0.92, 0.98),
    ("Bournemouth", "BOU", 0.94, 1.06),
    ("Nottingham Forest", "NFO", 0.90, 1.00),
    ("Wolves", "WOL", 0.86, 1.08),
    ("Everton", "EVE", 0.82, 1.02),
    ("Leicester", "LEI", 0.88, 1.16),
    ("Ipswich", "IPS", 0.80, 1.22),
    ("Southampton", "SOU", 0.76, 1.26),
]

# Démo tennis / basket : jeu de données réduit, juste pour valider les moteurs.
TENNIS_PLAYERS = [
    ("Jannik Sinner", 2085), ("Carlos Alcaraz", 2065), ("Novak Djokovic", 2010),
    ("Alexander Zverev", 1975), ("Daniil Medvedev", 1950), ("Taylor Fritz", 1915),
    ("Casper Ruud", 1895), ("Alex de Minaur", 1880), ("Andrey Rublev", 1870),
    ("Stefanos Tsitsipas", 1855), ("Tommy Paul", 1840), ("Holger Rune", 1830),
]

NBA_TEAMS = [
    ("Boston Celtics", 120.6, 109.2), ("Oklahoma City Thunder", 119.8, 107.5),
    ("Denver Nuggets", 118.2, 112.4), ("New York Knicks", 116.4, 110.8),
    ("Milwaukee Bucks", 117.0, 114.6), ("Dallas Mavericks", 116.8, 113.9),
    ("Minnesota Timberwolves", 113.2, 108.4), ("LA Clippers", 114.0, 112.0),
]


def _seed(*parts: object) -> int:
    """Graine déterministe : les mêmes entrées donnent toujours le même match."""
    h = hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()
    return int(h[:12], 16)


def _team_id(name: str, sport: str) -> int:
    h = hashlib.sha256(f"{sport}:{name}".encode()).hexdigest()
    return 1000 + int(h[:6], 16) % 89000


class DemoProvider(BaseProvider):
    """Génère un championnat fictif mais statistiquement cohérent."""

    name = "demo"

    def __init__(self, sport: str = "football", league_id: int = 39):
        self.sport = sport
        self.league_id = league_id
        self._fixtures: list[FixtureDTO] | None = None
        self._teams: dict[int, TeamDTO] = {}

    # ------------------------------------------------------------------
    # Construction du calendrier + des résultats
    # ------------------------------------------------------------------
    def _build_season(self) -> list[FixtureDTO]:
        if self._fixtures is not None:
            return self._fixtures

        teams = PREMIER_LEAGUE
        ids = [_team_id(n, "football") for n, _, _, _ in teams]
        for (name, short, _, _), tid in zip(teams, ids):
            self._teams[tid] = TeamDTO(
                id=tid, name=name, short=short,
                logo="", venue=f"{name} Stadium",
                league_id=self.league_id, sport="football",
            )

        n = len(ids)
        rounds: list[list[tuple[int, int]]] = []
        # Algorithme du cercle (round-robin classique)
        rot = ids[:]
        for r in range(n - 1):
            pairs = []
            for i in range(n // 2):
                home, away = rot[i], rot[n - 1 - i]
                if r % 2 == 1:  # alterne l'avantage du terrain
                    home, away = away, home
                pairs.append((home, away))
            rounds.append(pairs)
            rot = [rot[0]] + [rot[-1]] + rot[1:-1]

        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        # Journée en cours : on place le milieu de saison "aujourd'hui".
        current_round = 14
        fixtures: list[FixtureDTO] = []
        fid = 500_000

        for r_idx, pairs in enumerate(rounds):
            offset_days = (r_idx - current_round) * 7
            base = today + timedelta(days=offset_days)
            for k, (home, away) in enumerate(pairs):
                kickoff = base + timedelta(days=k % 3, hours=[12, 15, 17, 20][k % 4])
                played = r_idx < current_round
                hg = ag = None
                status = "FT"
                if not played:
                    status = "NS"
                else:
                    rng = random.Random(_seed(home, away, r_idx))
                    att_h = next(a for nm, sh, a, d in teams if _team_id(nm, "football") == home)
                    def_h = next(d for nm, sh, a, d in teams if _team_id(nm, "football") == home)
                    att_a = next(a for nm, sh, a, d in teams if _team_id(nm, "football") == away)
                    def_a = next(d for nm, sh, a, d in teams if _team_id(nm, "football") == away)
                    lam_h = max(0.15, att_h * def_a * 1.35 * 1.15)
                    lam_a = max(0.10, att_a * def_h * 1.10)
                    hg = min(9, _poisson(rng, lam_h))
                    ag = min(9, _poisson(rng, lam_a))
                fid += 1
                fixtures.append(FixtureDTO(
                    id=fid, league_id=self.league_id, home_id=home, away_id=away,
                    kickoff_utc=kickoff.isoformat(), round=f"Journée {r_idx + 1}",
                    venue=self._teams[home].venue, status=status,
                    home_goals=hg, away_goals=ag, season=2026, sport="football",
                ))

        self._fixtures = sorted(fixtures, key=lambda f: f.kickoff_utc)
        return self._fixtures

    # ------------------------------------------------------------------
    # Interface BaseProvider
    # ------------------------------------------------------------------
    def fetch_upcoming(self, league_ids: list[int], days_ahead: int) -> list[FixtureDTO]:
        now = datetime.now(timezone.utc)
        limit = now + timedelta(days=days_ahead)
        return [
            f for f in self._build_season()
            if f.status == "NS" and now <= _parse(f.kickoff_utc) <= limit
        ]

    def fetch_finished(self, league_ids: list[int], limit: int = 200) -> list[FixtureDTO]:
        done = [f for f in self._build_season() if f.status == "FT"]
        return sorted(done, key=lambda f: f.kickoff_utc, reverse=True)[:limit]

    def fetch_teams(self, league_id: int) -> list[TeamDTO]:
        self._build_season()
        return list(self._teams.values())

    def fetch_form(self, team_id: int, league_id: int, last: int = FORM_WINDOW) -> FormDTO | None:
        matches = [
            f for f in self._build_season()
            if f.status == "FT" and team_id in (f.home_id, f.away_id)
        ]
        matches.sort(key=lambda f: f.kickoff_utc, reverse=True)
        matches = matches[:last]
        if not matches:
            return None

        seq, pts, gf, ga = [], 0.0, 0.0, 0.0
        detail = []
        for f in sorted(matches, key=lambda x: x.kickoff_utc):
            is_home = f.home_id == team_id
            my, opp = (f.home_goals, f.away_goals) if is_home else (f.away_goals, f.home_goals)
            my, opp = int(my), int(opp)
            gf += my
            ga += opp
            if my > opp:
                seq.append("V"); pts += 3
            elif my == opp:
                seq.append("N"); pts += 1
            else:
                seq.append("D")
            opponent = self._teams[f.away_id if is_home else f.home_id].name
            detail.append({
                "date": f.kickoff_utc[:10],
                "home": "dom." if is_home else "ext.",
                "opponent": opponent,
                "score": f"{my}-{opp}",
                "result": seq[-1],
            })
        return FormDTO(
            team_id=team_id, league_id=league_id,
            form_string="".join(seq), form_points=pts,
            gf_avg=round(gf / len(matches), 2), ga_avg=round(ga / len(matches), 2),
            matches=detail, sport="football",
        )

    def fetch_h2h(self, home_id: int, away_id: int, limit: int = 10) -> H2HDTO | None:
        past = [
            f for f in self._build_season()
            if f.status == "FT" and {f.home_id, f.away_id} == {home_id, away_id}
        ]
        past.sort(key=lambda f: f.kickoff_utc, reverse=True)
        past = past[:limit]
        hw = dw = aw = 0
        goals = 0.0
        last = []
        for f in past:
            hg, ag = int(f.home_goals), int(f.away_goals)
            goals += hg + ag
            if hg > ag:
                hw += 1
                res = "1"
            elif hg == ag:
                dw += 1
                res = "X"
            else:
                aw += 1
                res = "2"
            last.append({
                "date": f.kickoff_utc[:10],
                "home": self._teams[f.home_id].name,
                "away": self._teams[f.away_id].name,
                "score": f"{hg}-{ag}",
                "result": res,
            })
        return H2HDTO(
            fixture_id=0, played=len(past), home_wins=hw, draws=dw, away_wins=aw,
            total_goals=round(goals / max(len(past), 1), 2), last=last, sport="football",
        )

    def fetch_injuries(self, fixture_id: int) -> list[InjuryDTO]:
        # 30 % des matchs ont un absent notable — suffisant pour tester l'affichage.
        rng = random.Random(_seed("inj", fixture_id))
        if rng.random() > 0.30:
            return []
        f = next((x for x in self._build_season() if x.id == fixture_id), None)
        if not f:
            return []
        tid = f.home_id if rng.random() < 0.5 else f.away_id
        return [InjuryDTO(
            fixture_id=fixture_id, team_id=tid,
            player=rng.choice([
                "Kevin De Bruyne", "Bukayo Saka", "Mohamed Salah", "Erling Haaland",
                "Cole Palmer", "Bruno Fernandes", "Declan Rice", "Virgil van Dijk",
            ]),
            reason=rng.choice(["Blessure musculaire", "Suspendu", "Cheville", "Reprise"]),
            is_key=True, sport="football",
        )]

    def fetch_standings(self, league_id: int, season: int) -> list[dict]:
        table: dict[int, dict] = {}
        for f in self.fetch_finished([league_id], limit=10_000):
            for tid in (f.home_id, f.away_id):
                table.setdefault(tid, {"team_id": tid, "played": 0, "points": 0, "gf": 0, "ga": 0})
            hg, ag = int(f.home_goals), int(f.away_goals)
            h, a = table[f.home_id], table[f.away_id]
            h["played"] += 1; a["played"] += 1
            h["gf"] += hg; h["ga"] += ag; a["gf"] += ag; a["ga"] += hg
            if hg > ag:
                h["points"] += 3
            elif hg == ag:
                h["points"] += 1; a["points"] += 1
            else:
                a["points"] += 3
        rows = sorted(table.values(), key=lambda r: (-r["points"], -(r["gf"] - r["ga"])))
        out = []
        for pos, r in enumerate(rows, start=1):
            out.append({
                "team_id": r["team_id"], "position": pos, "played": r["played"],
                "points": r["points"], "goal_diff": r["gf"] - r["ga"],
            })
        return out

    def health_check(self) -> tuple[bool, str]:
        n = len(self._build_season())
        return True, f"mode démo — {n} matchs de saison générés (données fictives)"


# ---------------------------------------------------------------------------
# Démo tennis et basket (jeux de données réduits)
# ---------------------------------------------------------------------------
class DemoTennisProvider:
    name = "demo-tennis"
    sport = "tennis"

    def matches(self, days_ahead: int = 7) -> list[dict]:
        now = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        out, rng = [], random.Random(_seed("tennis", now.date()))
        pairs = rng.sample(TENNIS_PLAYERS, 8)
        for i in range(0, 8, 2):
            a, b = pairs[i], pairs[i + 1]
            out.append({
                "id": _team_id(a[0] + b[0], "tennis"),
                "home": a[0], "away": b[0],
                "elo_home": a[1], "elo_away": b[1],
                "surface": rng.choice(["hard", "clay", "grass"]),
                "tournament": rng.choice(["ATP 500", "Masters 1000", "ATP 250"]),
                "kickoff_utc": (now + timedelta(days=rng.randint(0, days_ahead),
                                                hours=rng.choice([11, 13, 15, 18]))).isoformat(),
            })
        return sorted(out, key=lambda m: m["kickoff_utc"])


class DemoBasketProvider:
    name = "demo-basket"
    sport = "basket"

    def matches(self, days_ahead: int = 7) -> list[dict]:
        now = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        out, rng = [], random.Random(_seed("nba", now.date()))
        teams = NBA_TEAMS[:]
        rng.shuffle(teams)
        for i in range(0, 8, 2):
            a, b = teams[i], teams[i + 1]
            out.append({
                "id": _team_id(a[0] + b[0], "basket"),
                "home": a[0], "away": b[0],
                "off_home": a[1], "def_home": a[2],
                "off_away": b[1], "def_away": b[2],
                "pace_home": round(rng.uniform(96, 104), 1),
                "pace_away": round(rng.uniform(96, 104), 1),
                "kickoff_utc": (now + timedelta(days=rng.randint(0, days_ahead),
                                                hours=rng.choice([1, 2, 18, 19, 20]))).isoformat(),
            })
        return sorted(out, key=lambda m: m["kickoff_utc"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _parse(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def _poisson(rng: random.Random, lam: float) -> int:
    """Tirage de Poisson par inversion (Knuth) — `random` n'a pas de Poisson natif."""
    if lam <= 0:
        return 0
    threshold = 2.718281828459045 ** (-lam)
    k, p = 0, 1.0
    while True:
        p *= rng.random()
        if p <= threshold:
            return k
        k += 1
        if k > 30:
            return k
