"""Configuration centralisée de PronoLab.

Tout se pilote depuis ce fichier ou depuis des variables d'environnement.
Aucune clé n'est stockée dans le code : la clé API-Football se met dans `.env`.
"""

from __future__ import annotations

import os
from pathlib import Path

# ---------------------------------------------------------------------------
# Chargement manuel du fichier .env (évite une dépendance à python-dotenv)
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent          # .../prono/app
PROJECT_DIR = BASE_DIR.parent                       # .../prono
ENV_FILE = BASE_DIR / ".env"
# La base vit à la racine du projet, pas dans le paquet : plus facile à trouver,
# à sauvegarder et à supprimer.
DB_PATH = Path(os.getenv("PRONOLAB_DB", str(PROJECT_DIR / "prono.db")))


def _load_env_file(path: Path) -> None:
    """Lit un .env minimal (CLÉ=VALEUR par ligne, # = commentaire)."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:  # l'environnement réel reste prioritaire
            os.environ[key] = value


_load_env_file(ENV_FILE)

# ---------------------------------------------------------------------------
# Mode de données : 'demo' (synthétique) ou 'apifootball' (données réelles)
# ---------------------------------------------------------------------------
API_FOOTBALL_KEY = os.getenv("API_FOOTBALL_KEY", "").strip()
DATA_MODE = os.getenv("PRONOLAB_MODE", "demo" if not API_FOOTBALL_KEY else "apifootball")
if API_FOOTBALL_KEY and DATA_MODE == "demo":
    # Une clé est présente : on bascule automatiquement sur les vraies données.
    DATA_MODE = "apifootball"

API_FOOTBALL_HOST = os.getenv("API_FOOTBALL_HOST", "v3.football.api-sports.io")

# Rythme de la tâche planifiée, en minutes (défaut : 60 min).
SYNC_INTERVAL_MINUTES = int(os.getenv("PRONOLAB_SYNC_MINUTES", "60"))

# Fenêtre de récupération des matchs à venir, en jours.
FIXTURE_DAYS_AHEAD = int(os.getenv("PRONOLAB_DAYS_AHEAD", "7"))

# Nombre de matchs récents pris en compte pour la forme d'une équipe.
FORM_WINDOW = int(os.getenv("PRONOLAB_FORM_WINDOW", "6"))

# ---------------------------------------------------------------------------
# Ligues actives. `league_id` = identifiant API-Football (v3).
# Ajoutez une ligne ici pour couvrir une ligue de plus : rien d'autre à changer.
# ---------------------------------------------------------------------------
LEAGUES: dict[int, dict] = {
    39: {
        "name": "Premier League",
        "country": "Angleterre",
        "sport": "football",
        "short": "ENG",
        # Valeurs de référence saison (buts/match à domicile et à l'extérieur).
        # Elles sont recalculées automatiquement dès que la base contient des
        # résultats réels ; ces chiffres ne servent que d'amorçage.
        "home_avg_goals": 1.55,
        "away_avg_goals": 1.20,
        "home_advantage": 1.18,
    },
    140: {
        "name": "La Liga",
        "country": "Espagne",
        "sport": "football",
        "short": "ESP",
        "home_avg_goals": 1.45,
        "away_avg_goals": 1.05,
        "home_advantage": 1.20,
    },
    135: {
        "name": "Serie A",
        "country": "Italie",
        "sport": "football",
        "short": "ITA",
        "home_avg_goals": 1.50,
        "away_avg_goals": 1.15,
        "home_advantage": 1.17,
    },
}

# ---------------------------------------------------------------------------
# Paramètres des modèles
# ---------------------------------------------------------------------------
# Football — matrice de Poisson
MAX_GOALS = 10                 # bornes de la grille de scores (0..10)
OVER_UNDER_LINE = 2.5          # ligne over/under par défaut
DIXON_COLES_TAU_RHO = -0.08    # correction Dixon-Coles des petits scores (0-0, 1-0, 0-1, 1-1)

# Lissage bayesien : nombre de « matchs fictifs joues a la moyenne de la ligue »
# ajoutes a chaque equipe. Plus c'est haut, plus les forces sont ramenees vers la
# moyenne (prudent en debut de saison, mais ecrase les ecarts reels).
# /api/backtest permet de mesurer l'effet reel de ce reglage avant de le changer.
PRIOR_WEIGHT = float(os.getenv("PRONOLAB_PRIOR_WEIGHT", "1.0"))

# Tennis — Elo ajusté par surface
TENNIS_ELO_SCALE = 400.0
TENNIS_K_FACTOR = 24.0
TENNIS_SURFACE_ADJ = {"hard": 0.0, "clay": 0.0, "grass": 0.0}  # rempli par les stats réelles
TENNIS_SHARPNESS = 1.25        # multiplicateur du logit Elo (1.0 = Elo standard)

# Basket — points attendus
BASKET_HOME_EDGE = 2.8         # points d'avantage du terrain
BASKET_SPREAD_SD = 12.4        # écart-type de la marge finale (NBA ~ 12.4)
BASKET_OVER_UNDER_LINE = 224.5

# ---------------------------------------------------------------------------
# Divers
# ---------------------------------------------------------------------------
SITE_NAME = "PronoLab"
DISCLAIMER = (
    "Outil d'aide à la décision fondé sur des modèles statistiques. "
    "Aucun pronostic n'est garanti. Les jeux d'argent comportent un risque de perte. "
    "En France, seul l'opérateur agréé ANJ est légal. Jouez de façon responsable."
)
