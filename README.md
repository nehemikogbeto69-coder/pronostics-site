# PronoLab

Site de pronostics sportifs algorithmiques. Les matchs sont récupérés
automatiquement, les statistiques calculées à partir des résultats réels, et les
pronostics produits par des modèles statistiques — sans aucune saisie manuelle.

> **Usage personnel.** Outil d'aide à la décision. Aucun pronostic n'est garanti,
> et aucun modèle statistique ne supprime l'avantage structurel du bookmaker.

---

## État actuel

| Élément | État |
|---|---|
| Moteur Poisson (football) | ✅ complet, avec correction Dixon-Coles |
| Moteur Elo (tennis) | ✅ complet, ajusté par surface |
| Moteur points attendus (basket) | ✅ complet |
| Récupération API-Football | ✅ connecteur écrit, **non testé faute de clé** |
| Données réelles | ⛔ en attente de votre clé API |
| Données de démonstration | ✅ championnat fictif complet |
| Tâche planifiée | ✅ APScheduler, toutes les 60 min |
| Base de données | ✅ SQLite, 11 tables |
| Backtest | ✅ sans fuite d'information |
| Tests | ✅ 67 tests |

---

## Démarrage

```bash
cd prono
pip install -r requirements.txt
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Ouvrez **http://localhost:8000**. Au premier lancement, une synchronisation
part automatiquement en arrière-plan : comptez quelques secondes avant que les
matchs apparaissent.

Documentation interactive de l'API : **http://localhost:8000/docs**

### Lancer les tests

```bash
cd prono
python3 -m pytest -q
```

---

## Passer aux données réelles

Le site tourne actuellement en **mode démonstration** : un championnat fictif
est généré pour faire fonctionner tout le pipeline. Les chiffres affichés ne
sont **pas réels** — le bandeau jaune en haut du site vous le rappelle.

Pour basculer sur les vraies données :

1. Créez un compte gratuit sur **https://dashboard.api-football.io** (~100
   requêtes/jour, suffisant pour un usage personnel).
2. Créez le fichier `app/.env` :

   ```
   API_FOOTBALL_KEY=votre_cle_icI
   ```

3. Redémarrez le serveur. Le mode bascule automatiquement, le bandeau disparaît.

Vérifiez la connexion :

```bash
python3 verifier-cle-api.py
```

Le script interroge l'API (`/ping`, une seule requête) et vous dit précisément
ce qui ne va pas : clé absente, invalide, expirée, quota épuisé, ou tout est en
ordre. Il masque la clé et ne l'écrit nulle part.

Vous pouvez aussi interroger le site directement :

```bash
curl http://localhost:8000/api/health
```

Le champ `provider_message` indique votre compte et le quota consommé. Cet
endpoint ne lève plus d'exception : si l'API renvoie une forme de réponse
inattendue, il répond quand même avec un message explicatif.

### ⚠️ Le quota est la vraie contrainte

Le plan gratuit autorise ~100 requêtes par jour. Le connecteur est déjà économe
(cache en mémoire, délai de 6,5 s entre deux appel), mais **ne descendez pas
`PRONOLAB_SYNC_MINUTES` en dessous de 120** avec une seule ligue. Chaque
synchronisation consomme environ :

| Appel | Nombre |
|---|---|
| `/fixtures` (1 par jour × 7 jours × nb ligues) | 7 × ligues |
| `/teams` (1 par ligue) | ligues |
| `/teams/statistics` (1 par équipe) | ~20 × ligues |
| `/fixtures/headtohead` (1 par match) | ~10 × ligues |
| `/sidelined` (1 par match) | ~10 × ligues |

Pour tenir dans les 100 requêtes : **une seule ligue**, et un intervalle de
plusieurs heures. Avec 3 ligues actives, passez sur un plan payant ou réduisez
la liste dans `app/config.py`.

---

## Ajouter une ligue

Éditez `app/config.py` :

```python
LEAGUES = {
    39: {"name": "Premier League", "country": "Angleterre", "sport": "football",
         "short": "ENG", "home_avg_goals": 1.55, "away_avg_goals": 1.20,
         "home_advantage": 1.18},
    # ajoutez votre ligue ici — rien d'autre à modifier
    61: {"name": "Ligue 1", "country": "France", "sport": "football",
         "short": "FRA", "home_avg_goals": 1.45, "away_avg_goals": 1.10,
         "home_advantage": 1.17},
}
```

Les identifiants sont ceux d'API-Football v3 : `/v3/leagues`.

Les valeurs `home_avg_goals` / `away_avg_goals` ne servent **que d'amorçage** :
dès que la base contient des résultats, elles sont recalculées sur les matchs
réellement observés et réécrites en base.

---

## Les modèles

### Football — Poisson bivarié

```
force_attaque  = buts marqués de l'équipe   / moyenne de buts marqués de la ligue
force_défense  = buts encaissés de l'équipe / moyenne de buts encaissés de la ligue

λ_domicile = attaque_dom(home) × défense_ext(away) × moyenne_dom × avantage_terrain
λ_extérieur = attaque_ext(away) × défense_dom(home) × moyenne_ext

P(score i-j) = Poisson(i, λh) × Poisson(j, λa) × τ_DixonColes(i, j)
```

Les forces sont calculées **séparément à domicile et à l'extérieur**, car l'effet
terrain est réel et mesurable. Un lissage bayésien (`PRIOR_WEIGHT`) ajoute des
matchs fictifs joués à la moyenne de la ligue, pour éviter qu'une équipe à deux
journées obtienne une force extrême.

On en déduit directement, en sommant la matrice : 1X2, over/under 2,5, les deux
équipes marquent, et le score exact le plus probable.

**Correction Dixon-Coles** (`ρ = -0.08`) : un Poisson indépendant pur sous-estime
les 0-0 et 1-1. La correction porte sur le coin 2×2 de la matrice.

### Tennis — Elo ajusté par surface

```
E = 1 / (1 + 10^(-(Elo_A - Elo_B) / 400))
P(A gagne) = sigmoid(sharpness × logit(E))     avec sharpness = 1.25
```

Chaque joueur porte un Elo global plus un delta par surface (terre, gazon, dur,
indoor). `sharpness = 1.0` redonne exactement l'Elo classique ; 1.25 accentue
légèrement les écarts pour tenir compte du format long.

### Basket — points attendus

```
points_home = moyenne_ligue × ½(off_home + déf_away) × facteur_rythme + avantage_terrain
P(victoire) = Φ(marge_attendue / σ)                σ ≈ 12,4 points
```

Le total de points a une variance plus grande que la marge (les deux scores
varient dans le même sens), d'où un σ multiplié par √2 pour l'over/under.

### Indice de confiance

Ce n'est **pas** la probabilité brute du pronostic, qui surestime toujours la
certitude sur un match serré. Il combine :

1. la **marge** entre la meilleure issue et la deuxième ;
2. un **malus d'entropie** : un modèle à 34/33/33 n'a rien à dire.

```
confiance = 100 × marge / (marge + entropie) × (1 − 0,35 × entropie)
```

---

## Le backtest, ou comment savoir si ça vaut quelque chose

`GET /api/backtest?league_id=39&last_n=100`

Pour chaque match évalué, les forces des deux équipes sont recalculées **en
excluant ce match** et tout ce qui le suit. Aucune fuite d'information.

Métriques produites :

- **taux de réussite 1X2**, comparé à la référence « toujours jouer domicile » ;
- **log-loss** et **score de Brier** : qualité des probabilités, pas seulement
  du choix ;
- **calibration** : les matchs annoncés à 70 % gagnent-ils ~70 % du temps ?

Résultats mesurés sur les données de démonstration (100 matchs) :

| Métrique | Valeur | Lecture |
|---|---|---|
| Réussite 1X2 | 51 % | contre 47 % pour « toujours domicile » |
| Écart vs référence | +4 pts | faible, mais positif |
| Log-loss | 1,085 | à comparer aux cotes réelles du marché |

**Soyez lucide sur ces chiffres.** Un écart de +4 points sur 100 matchs n'est
pas statistiquement significatif. Et la simulation de ROI intégrée utilise des
cotes *déduites du modèle* avec une marge bookmaker incluse : elle produit
mécaniquement un ROI négatif. Un vrai calcul de rentabilité exige les cotes
historiques réelles du marché, que ce projet ne collecte pas encore.

---

## Structure

```
prono/
├── app/
│   ├── config.py          ligue, paramètres des modèles, variables d'environnement
│   ├── db.py              schéma SQLite et helpers
│   ├── main.py            API FastAPI
│   ├── sync.py            pipeline : récupération → stats → pronostic
│   ├── scheduler.py       tâche planifiée (APScheduler)
│   ├── backtest.py        évaluation du modèle
│   ├── models/
│   │   ├── football.py    Poisson bivarié + Dixon-Coles
│   │   ├── tennis.py      Elo par surface
│   │   ├── basketball.py  points attendus
│   │   └── confidence.py  indice de confiance commun
│   └── providers/
│       ├── base.py        contrat commun (DTO)
│       ├── apifootball.py connecteur API-Football (données réelles)
│       └── demo.py        générateur synthétique
├── static/                frontend (HTML/CSS/JS, sans dépendance)
├── tests/
└── requirements.txt
```

---

## API

| Endpoint | Rôle |
|---|---|
| `GET /api/meta` | mode de données, ligues, prochaine sync |
| `GET /api/matches?sport=&league=&days=&min_confidence=` | matchs + pronostics |
| `GET /api/match/{id}` | détail : stats, forces, forme, H2H, blessés, matrice |
| `GET /api/standings/{league_id}` | classement et forces |
| `GET /api/backtest?league_id=&last_n=` | performance du modèle |
| `GET /api/health` | état de la source et de la base |
| `POST /api/sync?days=` | synchronisation immédiate |

---

## Configuration

Variables d'environnement (ou `app/.env`) :

| Variable | Défaut | Rôle |
|---|---|---|
| `API_FOOTBALL_KEY` | — | clé API ; sa présence active le mode réel |
| `PRONOLAB_MODE` | auto | `demo` ou `apifootball` |
| `PRONOLAB_SYNC_MINUTES` | 60 | intervalle de synchronisation |
| `PRONOLAB_DAYS_AHEAD` | 7 | fenêtre de récupération |
| `PRONOLAB_FORM_WINDOW` | 6 | matchs pris en compte pour la forme |
| `PRONOLAB_PRIOR_WEIGHT` | 1.0 | force du lissage bayésien |
| `PRONOLAB_DB` | `prono.db` | chemin de la base |

---

## Limites connues

À lire avant de vous fier aux pronostics.

1. **Les données affichées sont fictives** tant qu'aucune clé API n'est fournie.
2. **Les blessés sont affichés mais pas intégrés au calcul.** L'absence d'un
   joueur majeur fausse pourtant nettement les forces d'une équipe.
3. **Pas de cotes de bookmaker.** Impossible de détecter de la valeur sans
   comparer au marché. Le ROI simulé n'a donc aucune valeur prédictive.
4. **Tennis et basket tournent sur des données de démonstration.** Les moteurs
   sont écrits et testés, mais aucun connecteur réel n'est branché pour ces
   sports.
5. **Le modèle ignore le contexte** : enjeu du match, rotation d'effectif,
   fatigue, météo, changement d'entraîneur.
6. **Le backtest est court.** 100 matchs ne permettent pas de conclure. Il
   faudrait plusieurs saisons pour une évaluation sérieuse.
7. **En production, déplacez le planificateur** vers un cron externe : avec
   plusieurs workers, chacun synchroniserait de son côté.
