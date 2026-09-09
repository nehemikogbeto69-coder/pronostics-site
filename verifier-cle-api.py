#!/usr/bin/env python3
"""Diagnostic de la clé API-Football.

À lancer là où tourne le site (Render, votre machine, peu importe) :

    python3 verifier-cle-api.py

Le script interroge API-Football et vous dit précisément ce qui ne va pas.
Il ne fait qu'UNE requête (`/ping`), donc il ne consomme presque rien du quota.

La clé est lue depuis l'environnement ou depuis `app/.env`. Elle n'est jamais
affichée en entier.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import httpx

HOST = os.getenv("API_FOOTBALL_HOST", "v3.football.api-sports.io")
ENV_FILE = Path(__file__).resolve().parent / "app" / ".env"


def load_key() -> tuple[str, str]:
    """Retourne (clé, provenance). Ne lève pas d'exception."""
    key = os.getenv("API_FOOTBALL_KEY", "").strip()
    if key:
        return key, "variable d'environnement"
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("API_FOOTBALL_KEY") and "=" in line:
                return line.split("=", 1)[1].strip().strip('"').strip("'"), f"fichier {ENV_FILE}"
    return "", "aucune source"


def mask(key: str) -> str:
    if not key:
        return "(vide)"
    if len(key) <= 8:
        return key[0] + "…"
    return f"{key[:4]}…{key[-4:]} ({len(key)} caractères)"


def main() -> int:
    print("=" * 62)
    print("Diagnostic de la clé API-Football")
    print("=" * 62)

    key, source = load_key()
    print(f"\nClé     : {mask(key)}")
    print(f"Source  : {source}")
    print(f"Hôte    : {HOST}")

    if not key:
        print("\n❌ Aucune clé trouvée.")
        print("   Sur Render : onglet « Environment », ajoutez API_FOOTBALL_KEY.")
        print("   En local   : copiez .env.example vers app/.env et renseignez-la.")
        return 1

    problèmes = []
    if " " in key:
        problèmes.append("contient un espace")
    if key.startswith(("'", '"')) or key.endswith(("'", '"')):
        problèmes.append("contient des guillemets")
    if not key.startswith(("ghp", "")) and len(key) < 20:
        problèmes.append("semble trop courte")
    if problèmes:
        print("\n⚠️  La clé a une forme suspecte : " + ", ".join(problèmes) + ".")

    print("\n--- Test de l'API (/ping, 1 requête) ---")
    try:
        r = httpx.get(
            f"https://{HOST}/ping",
            headers={"x-apisports-key": key},
            timeout=20,
        )
    except httpx.HTTPError as exc:
        print(f"\n❌ Impossible de joindre l'API : {type(exc).__name__}: {exc}")
        return 1

    print(f"HTTP {r.status_code}")
    try:
        body = r.json()
    except ValueError:
        print(f"❌ Réponse non-JSON (l'API a renvoyé autre chose que du JSON) :\n{r.text[:300]}")
        return 1

    errors = body.get("errors")
    if errors:
        print(f"\n❌ L'API signale une erreur : {errors}")
        texte = str(errors).lower()
        if "missing" in texte:
            print("   → La clé n'est pas parvenue jusqu'à l'API. Vérifiez le nom")
            print("     exact de la variable : API_FOOTBALL_KEY.")
        elif "invalid" in texte or "wrong" in texte:
            print("   → La clé est invalide ou expirée. Régénérez-la sur")
            print("     https://dashboard.api-football.io")
        else:
            print("   → Consultez le message ci-dessus.")
        return 1

    if r.status_code == 403:
        print("\n❌ HTTP 403 : clé refusée (absente, invalide ou expirée).")
        return 1

    print("\n✅ La clé fonctionne : l'API répond sans erreur.")

    print("\n--- État du compte (/status) ---")
    try:
        r2 = httpx.get(
            f"https://{HOST}/status",
            headers={"x-apisports-key": key},
            timeout=20,
        )
        body2 = r2.json()
    except Exception as exc:
        print(f"⚠️  /status indisponible : {type(exc).__name__}: {exc}")
        print("   Ce n'est pas bloquant : /ping a déjà validé la clé.")
        return 0

    resp = body2.get("response")
    info = None
    if isinstance(resp, dict):
        info = resp
    elif isinstance(resp, list):
        info = next((i for i in resp if isinstance(i, dict)), None)

    if not info:
        print(f"⚠️  /status n'a pas renvoyé d'info de compte (type : {type(resp).__name__}).")
        print("   La clé est valide, c'est seulement cet endpoint qui est muet.")
        return 0

    acc = info.get("account") if isinstance(info.get("account"), dict) else {}
    req = info.get("requests") if isinstance(info.get("requests"), dict) else {}
    nom = " ".join(p for p in (acc.get("firstname"), acc.get("lastname")) if p).strip() \
        or acc.get("email", "?")
    print(f"   Compte     : {nom}")
    print(f"   Offre      : {acc.get('subscription', '?')}")
    print(f"   Aujourd'hui: {req.get('current', '?')} / {req.get('limit_day', '?')} requêtes")

    cur, lim = req.get("current"), req.get("limit_day")
    if isinstance(cur, int) and isinstance(lim, int) and lim and cur >= lim:
        print("\n❌ Quota journalier épuisé. Attendez la réinitialisation,")
        print("   ou augmentez PRONOLAB_SYNC_MINUTES pour consommer moins.")
        return 1

    print("\n✅ Tout est en ordre.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
