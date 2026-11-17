#!/bin/bash
# Atalho: ./arquivar-evento.sh [event-id] [--dry-run]
# Sem argumentos, lista os eventos e deixa escolher pelo número.
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
exec npm run -s archive:event -- "$@"
