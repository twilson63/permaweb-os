#!/bin/sh
set -eu

# Seed default settings if not present
if [ ! -f ~/.opencode/settings.json ]; then
  mkdir -p ~/.opencode
  # Use OPENCODE_MODEL env var or default to big-pickle (free tier)
  DEFAULT_MODEL="${OPENCODE_MODEL:-opencode/big-pickle}"
  echo "{\"defaultModel\":\"${DEFAULT_MODEL}\"}" > ~/.opencode/settings.json
fi

if [ "$#" -eq 0 ]; then
  exec opencode serve --hostname "${OPENCODE_HOST:-0.0.0.0}" --port "${OPENCODE_PORT:-4096}"
fi

case "$1" in
  -*)
    exec opencode "$@"
    ;;
  serve|web|run|acp|mcp|completion|attach|debug|auth|agent|upgrade|uninstall|models|stats|export|import|github|pr|session|db)
    exec opencode "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
