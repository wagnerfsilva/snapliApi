#!/bin/bash
# Atalho: ./arquivar-evento.sh <event-id> [--dry-run]
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
exec npm run -s archive:event -- "$@"
