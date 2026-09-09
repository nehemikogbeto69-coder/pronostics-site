"""Sources de données disponibles."""

from .base import BaseProvider

__all__ = ["BaseProvider", "get_provider"]


def get_provider(mode: str = "demo", sport: str = "football", league_id: int = 39):
    """Fabrique de providers selon le mode configuré."""
    if mode == "apifootball":
        from .apifootball import APIFootballProvider
        return APIFootballProvider()
    from .demo import DemoProvider
    return DemoProvider(sport=sport, league_id=league_id)
