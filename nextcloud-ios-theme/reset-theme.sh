#!/usr/bin/env bash
# Setzt Nextcloud auf das ursprüngliche Design zurück (macht apply-theme.sh rückgängig).
#
# Aufruf:
#   ./reset-theme.sh [container-name]        (Standard: nextcloud)
set -uo pipefail

CONTAINER="${1:-nextcloud}"
NC_USER="${NC_USER:-www-data}"

occ() {
	docker exec -u "$NC_USER" "$CONTAINER" php occ "$@"
}

echo "==> Prüfe Container '$CONTAINER' ..."
occ status >/dev/null || exit 1

echo "==> Entferne Custom CSS und deaktiviere die App ..."
occ config:app:delete theming_customcss customcss
occ config:app:delete theming_customcss cachebuster
occ app:disable theming_customcss

echo "==> Setze Farben und Hintergrund auf Standard zurück ..."
for key in primary_color color background_color background; do
	occ theming:config --reset "$key" >/dev/null 2>&1 || true
done

echo "==> Nutzer dürfen wieder eigenes Design wählen, Hell/Dunkel nicht mehr erzwungen ..."
occ config:app:set theming disable-user-theming --value="no"
occ config:system:delete enforce_theme >/dev/null 2>&1 || true

echo "==> Leere Caches ..."
occ maintenance:repair >/dev/null

echo
echo "Fertig. Nextcloud zeigt wieder das Standard-Design (ggf. Strg+F5)."
