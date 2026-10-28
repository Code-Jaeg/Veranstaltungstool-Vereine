#!/bin/sh
# Datenverzeichnis (Bind-Mount, z. B. auf der Synology) dem Benutzer "node" geben und Rechte abgeben.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${DATA_DIR:-/data}"
  chown -R node:node "${DATA_DIR:-/data}"
  exec su-exec node "$@"
fi
exec "$@"
