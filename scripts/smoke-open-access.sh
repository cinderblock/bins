#!/usr/bin/env bash
# Smoke test for OPEN_ACCESS against a REAL running server (api/dev.ts over
# TCP), as opposed to api.test.ts which calls handleApi() directly. What this
# adds over the unit tests is the env plumbing and real HTTP framing.
#
# Uses a throwaway database under data/smoke/ — never the dev db.
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${API_PORT:-3401}"
SMOKE_DIR="data/smoke"
rm -rf "$SMOKE_DIR"

export API_PORT="$PORT"
export DATABASE_PATH="$SMOKE_DIR/smoke.db"
export PHOTOS_PATH="$SMOKE_DIR/photos"
export OPEN_ACCESS=1

bun api/dev.ts &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 40); do
	if curl -fsS "http://localhost:$PORT/api/landing" >/dev/null 2>&1; then break; fi
	sleep 0.25
done

api() {
	local method="$1" path="$2" body="${3:-}" xff="${4:-}"
	local args=(-sS -o /tmp/smoke-body -w '%{http_code}' -X "$method")
	[ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
	[ -n "$xff" ] && args+=(-H "X-Forwarded-For: $xff")
	curl "${args[@]}" "http://localhost:$PORT$path"
}

fail=0
check() {
	local label="$1" want="$2" got="$3"
	if [ "$want" = "$got" ]; then
		echo "  ok   $label ($got)"
	else
		echo "  FAIL $label — wanted $want, got $got"
		echo "       body: $(cat /tmp/smoke-body)"
		fail=1
	fi
}

echo "landing advertises the mode:"
code=$(api GET /api/landing)
check "GET /api/landing" 200 "$code"
grep -q '"openAccess":true' /tmp/smoke-body \
	&& echo "  ok   openAccess:true advertised" \
	|| { echo "  FAIL openAccess not advertised: $(cat /tmp/smoke-body)"; fail=1; }

echo "before setup there is no group to join:"
code=$(api POST /api/auth/join-open \
	"{\"displayName\":\"Smoke\",\"deviceId\":\"$(uuidgen)\"}" 10.0.0.5)
check "join-open pre-setup" 503 "$code"

echo "first-boot setup:"
code=$(api POST /api/setup \
	"{\"groupName\":\"Smoke Co\",\"accessCode\":\"smoke-code\",\"adminPassword\":\"smoke-pw\",\"displayName\":\"Ops\",\"deviceId\":\"$(uuidgen)\"}")
check "POST /api/setup" 200 "$code"

echo "open join from the LAN:"
code=$(api POST /api/auth/join-open \
	"{\"displayName\":\"Warehouse iPad\",\"deviceId\":\"$(uuidgen)\"}" 10.0.0.5)
check "join-open (private client)" 200 "$code"
TOKEN=$(sed -n 's/.*"token":"\([^"]*\)".*/\1/p' /tmp/smoke-body)

echo "the minted token is a normal member token:"
code=$(curl -sS -o /tmp/smoke-body -w '%{http_code}' \
	-H "Authorization: Bearer $TOKEN" "http://localhost:$PORT/api/auth/me")
check "GET /api/auth/me" 200 "$code"

echo "open join from the internet is refused:"
code=$(api POST /api/auth/join-open \
	"{\"displayName\":\"Internet\",\"deviceId\":\"$(uuidgen)\"}" 203.0.113.7)
check "join-open (public client)" 403 "$code"

echo "stickers allocate codeless:"
code=$(curl -sS -o /tmp/smoke-body -w '%{http_code}' -X POST \
	-H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
	-d '{"adminPassword":"smoke-pw","count":2}' \
	"http://localhost:$PORT/api/admin/bins/allocate")
check "POST /api/admin/bins/allocate" 200 "$code"
grep -q '"code":null' /tmp/smoke-body \
	&& echo "  ok   allocated stickers carry no secret" \
	|| { echo "  FAIL expected null codes: $(cat /tmp/smoke-body)"; fail=1; }

# Stop the server before cleaning up: it holds the SQLite file open, and on
# Windows an open handle makes the directory undeletable.
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
rm -rf "$SMOKE_DIR" 2>/dev/null || true

[ "$fail" = 0 ] && echo "SMOKE PASS" || { echo "SMOKE FAIL"; exit 1; }
