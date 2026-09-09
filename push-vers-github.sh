#!/usr/bin/env bash
# Pousse le dépôt vers GitHub.
#
# Deux façons de l'utiliser :
#
#   1) Depuis votre propre machine, après avoir copié le dossier `prono` :
#        bash push-vers-github.sh
#
#   2) Dans cet environnement, en fournissant un jeton :
#        GH_TOKEN=ghp_votre_jeton bash push-vers-github.sh
#
# Le jeton n'est JAMAIS écrit sur le disque : il n'est utilisé que le temps
# de la commande, puis l'URL du remote est réinitialisée sans secret.

set -euo pipefail

cd "$(dirname "$0")"

REMOTE="https://github.com/nehemikogbeto69-coder/pronostics-site.git"

echo "== Dépôt local =="
echo "   branche  : $(git branch --show-current)"
echo "   commit   : $(git rev-parse --short HEAD)"
echo "   fichiers : $(git ls-files | wc -l)"
echo

if [ -z "${GH_TOKEN:-}" ]; then
  echo "Aucun GH_TOKEN fourni : push en mode interactif."
  echo "GitHub demandera un identifiant puis un jeton en guise de mot de passe."
  echo
  git push -u origin main
  exit 0
fi

echo "Jeton détecté : push non interactif."
echo

# URL avec jeton, utilisée uniquement pour cette commande.
AUTH_URL="https://x-access-token:${GH_TOKEN}@github.com/nehemikogbeto69-coder/pronostics-site.git"

# On s'assure que le remote stocké ne contiendra jamais le secret.
git remote set-url origin "$REMOTE"

if git push "$AUTH_URL" main:main; then
  echo
  echo "Push réussi."
  # Branche de suivi, sans secret dans la config.
  git branch --set-upstream-to=origin/main main 2>/dev/null || true
  echo "Dépôt : https://github.com/nehemikogbeto69-coder/pronostics-site"
else
  code=$?
  echo
  echo "Échec du push (code $code)." >&2
  echo "Vérifiez que le jeton a bien le droit « repo », et qu'il n'est pas expiré." >&2
  exit $code
fi
