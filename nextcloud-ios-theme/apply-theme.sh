#!/usr/bin/env bash
# Spielt ein Theme serverweit in eine Nextcloud (Docker) ein.
#
# Aufruf:
#   ./apply-theme.sh [container-name] [theme]
#     container-name  Standard: nextcloud (AIO: nextcloud-aio-nextcloud)
#     theme           catppuccin (Standard, Catppuccin Latte) | apple
#   NC_USER=www-data ./apply-theme.sh nextcloud-app apple
#
# Benötigt: docker, laufender Nextcloud-Container (offizielles Image oder AIO).
set -euo pipefail

CONTAINER="${1:-nextcloud}"
THEME="${2:-catppuccin}"
NC_USER="${NC_USER:-www-data}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

case "$THEME" in
	catppuccin)
		CSS_FILE="$SCRIPT_DIR/catppuccin-latte.css"
		PRIMARY="#8839EF"   # Catppuccin Latte Mauve
		BACKGROUND="#DCE0E8" # Catppuccin Latte Crust
		ENFORCE_THEME="light"
		;;
	apple)
		CSS_FILE="$SCRIPT_DIR/ios-theme.css"
		PRIMARY="#0071E3"
		BACKGROUND="#F5F5F7"
		ENFORCE_THEME=""
		;;
	*)
		echo "Unbekanntes Theme '$THEME' (erlaubt: catppuccin, apple)" >&2
		exit 1
		;;
esac

occ() {
	docker exec -u "$NC_USER" "$CONTAINER" php occ "$@"
}

echo "==> Prüfe Container '$CONTAINER' ..."
occ status >/dev/null

echo "==> Installiere/aktiviere App 'Custom CSS' (theming_customcss) ..."
occ app:install theming_customcss 2>/dev/null || true
occ app:enable theming_customcss

echo "==> Schreibe CSS für Theme '$THEME' (gilt für alle Nutzer) ..."
# CSS über stdin in den Container kopieren, damit Sonderzeichen sicher bleiben
docker exec -i -u "$NC_USER" "$CONTAINER" sh -c 'cat > /tmp/nc-theme.css' < "$CSS_FILE"
docker exec -u "$NC_USER" "$CONTAINER" sh -c \
	'php occ config:app:set theming_customcss customcss --value="$(cat /tmp/nc-theme.css)" && rm /tmp/nc-theme.css'
# Cache der Custom-CSS-App erneuern, damit Browser die neue Version laden
occ config:app:set theming_customcss cachebuster --value="$(date +%s)"

echo "==> Setze Theming: Primärfarbe $PRIMARY, Hintergrund $BACKGROUND ..."
occ theming:config primary_color "$PRIMARY" || occ theming:config color "$PRIMARY"
occ theming:config background_color "$BACKGROUND" 2>/dev/null \
	|| echo "    (background_color wird von dieser Version nicht unterstützt, übersprungen)"
occ theming:config background backgroundColor 2>/dev/null || true

echo "==> Verhindere, dass Nutzer eigene Farben/Hintergründe setzen ..."
occ config:app:set theming disable-user-theming --value="yes"

if [ -n "$ENFORCE_THEME" ]; then
	echo "==> Erzwinge Erscheinungsbild '$ENFORCE_THEME' für alle Nutzer ..."
	occ config:system:set enforce_theme --value="$ENFORCE_THEME"
else
	occ config:system:delete enforce_theme >/dev/null 2>&1 || true
fi

echo "==> Leere Caches ..."
occ maintenance:repair --include-expensive >/dev/null 2>&1 || occ maintenance:repair >/dev/null

echo
echo "Fertig. Alle Nutzer sehen das Theme nach einem Neuladen (ggf. Strg+F5)."
