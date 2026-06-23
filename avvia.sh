#!/usr/bin/env bash
# Avvia ClonePremiere su un server locale e apre il browser.
# I moduli ES NON funzionano aprendo index.html con doppio click (file://):
# va servito via http. Questo script fa tutto.

set -e
cd "$(dirname "$0")"

PORT="${1:-8099}"
URL="http://127.0.0.1:${PORT}/"

if ! command -v php >/dev/null 2>&1; then
  echo "PHP non trovato. Installa PHP 8.1+ (sudo apt install php-cli php-sqlite3)."; exit 1
fi

echo "ClonePremiere su ${URL}"
echo "Premi Ctrl+C per fermare."

# apri il browser (best-effort)
( sleep 1; (xdg-open "$URL" || open "$URL") >/dev/null 2>&1 || true ) &

php -S "127.0.0.1:${PORT}"
