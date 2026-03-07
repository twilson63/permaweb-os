#!/usr/bin/env bash

set -euo pipefail

POD_NAME="${WEB_OS_POD_NAME:-user-pod}"
POD_BASE_DOMAIN="${POD_BASE_DOMAIN:-127.0.0.1.nip.io}"
POD_HOST="${POD_NAME}.${POD_BASE_DOMAIN}"
API_HEALTH_URL="http://${POD_HOST}/health"
FRONTEND_URL="http://${POD_HOST}/"

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "error: required command not found: ${cmd}" >&2
    exit 1
  fi
}

echo "==> Validating prerequisites"
require_command python3
require_command curl

echo "==> Checking wildcard DNS resolution for ${POD_HOST}"
DNS_IP="$(python3 - "$POD_HOST" <<'PY'
import socket
import sys

host = sys.argv[1]
print(socket.gethostbyname(host))
PY
)"
echo "resolved ${POD_HOST} -> ${DNS_IP}"

echo "==> Checking API health endpoint"
HEALTH_RESPONSE="$(curl -sS --fail "${API_HEALTH_URL}")"
echo "${HEALTH_RESPONSE}" | python3 -c 'import json,sys; payload=json.load(sys.stdin); assert payload.get("status") == "ok"'
echo "api ok: ${API_HEALTH_URL}"

echo "==> Checking frontend endpoint"
FRONTEND_CODE="$(curl -sS -o /dev/null -w '%{http_code}' "${FRONTEND_URL}")"
if [[ "${FRONTEND_CODE}" == "000" ]]; then
  echo "error: frontend endpoint unreachable: ${FRONTEND_URL}" >&2
  exit 1
fi

echo "frontend reachable (${FRONTEND_CODE}): ${FRONTEND_URL}"
echo
echo "Wildcard ingress checks passed."
