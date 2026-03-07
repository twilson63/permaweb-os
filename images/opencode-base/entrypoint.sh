#!/bin/sh
set -eu

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
