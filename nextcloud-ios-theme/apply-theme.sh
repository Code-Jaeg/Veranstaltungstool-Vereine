#!/usr/bin/env bash
# Spielt das iOS-Theme serverweit in eine Nextcloud (Docker) ein.
#
# Aufruf:
#   ./apply-theme.sh [container-name]        (Standard: nextcloud)
#   NC_USER=www-data ./apply-theme.sh nextcloud-app
#
# Benötigt: docker, laufender Nextcloud-Container (offizielles Image oder AIO).
set -euo pipefail

CONTAINER="${1:-nextcloud}"
NC_USER="${NC_USER:-www-data}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CSS_FILE="$SCRIPT_DIR/ios-theme.css"

occ() {
	docker exec -u "$NC_USER" "$CONTAINER" php occ "$@"
}

echo "==> Prüfe Container '$CONTAINER' ..."
occ status >/dev/null

echo "==> Installiere/aktiviere App 'Custom CSS' (theming_customcss) ..."
occ app:install theming_customcss 2>/dev/null || true
occ app:enable theming_customcss

echo "==> Schreibe iOS-CSS (gilt für alle Nutzer) ..."
# CSS über stdin in den Container kopieren, damit Sonderzeichen sicher bleiben
docker exec -i -u "$NC_USER" "$CONTAINER" sh -c 'cat > /tmp/ios-theme.css' < "$CSS_FILE"
docker exec -u "$NC_USER" "$CONTAINER" sh -c \
	'php occ config:app:set theming_customcss customcss --value="$(cat /tmp/ios-theme.css)" && rm /tmp/ios-theme.css'
# Cache der Custom-CSS-App erneuern, damit Browser die neue Version laden
occ config:app:set theming_customcss cachebuster --value="$(date +%s)"

echo "==> Setze Theming: iOS-Blau und neutraler Hintergrund ..."
occ theming:config primary_color "#007AFF" || occ theming:config color "#007AFF"
occ theming:config background_color "#F2F2F7" 2>/dev/null \
	|| echo "    (background_color wird von dieser Version nicht unterstützt, übersprungen)"
occ theming:config background backgroundColor 2>/dev/null || true

echo "==> Verhindere, dass Nutzer eigene Farben/Hintergründe setzen ..."
occ config:app:set theming disable-user-theming --value="yes"

echo "==> Leere Caches ..."
occ maintenance:repair --include-expensive >/dev/null 2>&1 || occ maintenance:repair >/dev/null

echo
echo "Fertig. Alle Nutzer sehen das Theme nach einem Neuladen (ggf. Strg+F5)."
