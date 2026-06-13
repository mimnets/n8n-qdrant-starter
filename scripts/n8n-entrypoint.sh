#!/bin/sh
set -e

CONFIG="/home/node/.n8n/config"

if [ -f "$CONFIG" ]; then
    if ! node -e "JSON.parse(require('fs').readFileSync('$CONFIG','utf8'))" 2>/dev/null; then
        echo "n8n config is invalid JSON, removing so it can be regenerated"
        rm "$CONFIG"
    fi
fi

exec /docker-entrypoint.sh "$@"
