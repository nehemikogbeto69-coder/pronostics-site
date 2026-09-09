"""Contrat commun à toutes les sources de données sportives.

Ajouter une nouvelle API = écrire une classe qui hérite de `BaseProvider`.
Le reste du site (sync, modèles, interface) ne change pas.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class TeamDTO:
    id: int
    name: str
    short: str = ""
    logo: str = ""
    venue: str = ""
    league_id: int = 0
    sport: str = "football"


@dataclass
class FixtureDTO:
    id: int
    league_id: int
    home_id: int
    away_id: int
    kickoff_utc: str            # ISO 8601, UTC
    round: str = ""
    venue: str = ""
    status: str = "NS"          # NS = non joué, FT = terminé
    home_goals: int | None = None
    away_goals: int | None = None
    season: int = 0
    sport: str = "football"


@dataclass
class TeamStatsDTO:
    team_id: int
    league_id: int
    season: int
    played: int = 0
    played_home: int = 0
    played_away: int = 0
    goals_for: float = 0.0
    goals_against: float = 0.0
    home_gf: float = 0.0
    home_ga: float = 0.0
    away_gf: float = 0.0
    away_ga: float = 0.0
    points: int = 0
    wins: int = 0
    draws: int = 0
    losses: int = 0
    position: int = 0
    sport: str = "football"


@dataclass
class FormDTO:
    team_id: int
    league_id: int
    form_string: str = ""       # ex. "WWDLW" (plus récent à droite)
    form_points: float = 0.0
    gf_avg: float = 0.0
    ga_avg: float = 0.0
    matches: list[dict] = field(default_factory=list)
    sport: str = "football"


@dataclass
class H2HDTO:
    fixture_id: int
    played: int = 0
    home_wins: int = 0
    draws: int = 0
    away_wins: int = 0
    total_goals: float = 0.0
    last: list[dict] = field(default_factory=list)
    sport: str = "football"


@dataclass
class InjuryDTO:
    fixture_id: int
    team_id: int
    player: str
    reason: str = ""
    is_key: bool = False
    sport: str = "football"


class BaseProvider(ABC):
    """Source de données. Toutes les méthodes retournent des DTO, jamais du brut."""

    name: str = "base"
    sport: str = "football"

    @abstractmethod
    def fetch_upcoming(self, league_ids: list[int], days_ahead: int) -> list[FixtureDTO]:
        """Matchs à venir, toutes ligues confondues."""

    @abstractmethod
    def fetch_finished(self, league_ids: list[int], limit: int = 200) -> list[FixtureDTO]:
        """Matchs déjà joués : servent à caler les forces d'attaque/défense."""

    @abstractmethod
    def fetch_teams(self, league_id: int) -> list[TeamDTO]:
        ...

    @abstractmethod
    def fetch_form(self, team_id: int, league_id: int, last: int = 6) -> FormDTO | None:
        ...

    @abstractmethod
    def fetch_h2h(self, home_id: int, away_id: int, limit: int = 10) -> H2HDTO | None:
        ...

    @abstractmethod
    def fetch_injuries(self, fixture_id: int) -> list[InjuryDTO]:
        ...

    def fetch_standings(self, league_id: int, season: int) -> list[dict[str, Any]]:
        """Optionnel : classement. Retourne [] si l'API ne le fournit pas."""
        return []

    def health_check(self) -> tuple[bool, str]:
        """Vérifie que la source répond. Retourne (ok, message)."""
        return True, "ok"
