#!/usr/bin/env bash
# @@@ client-assert - drive the refactored spex CLI as a pure backend CLIENT against API_URL (a LOCAL or, over
# a tunnel, a REMOTE backend) and assert the broker contract. NON-FORGIVING: provenance by random uuid (a
# localhost backend cannot satisfy it), capture nonce must cross the wire, fail must be DISTINCT from empty,
# send must fail LOUD, and no-backend must error (never exit 0 with blank output).
# Env: SPEX_CLI (path to the refactored spec-cli used as the client) · API_URL · SID_A · SID_B · NONCE
set -uo pipefail
: "${SPEX_CLI:?}"; : "${API_URL:?}"; : "${SID_A:?}"; : "${SID_B:?}"; : "${NONCE:?}"
SPEX() { SPEXCODE_API_URL="$API_URL" "$SPEX_CLI/node_modules/.bin/tsx" "$SPEX_CLI/src/cli.ts" "$@"; }
PASS=0; FAIL=0
ok(){ echo "  PASS  $1"; PASS=$((PASS+1)); }
no(){ echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

echo "== client → $API_URL =="

# 1. PROVENANCE — the board over the wire must carry BOTH random uuids only this host created (a localhost
#    backend with no such sessions cannot pass; exit-0 alone is never trusted).
LS="$(SPEX ls --json 2>/dev/null)"
if grep -q "$SID_A" <<<"$LS" && grep -q "$SID_B" <<<"$LS"; then ok "provenance: remote board lists SID_A and SID_B"; else no "provenance: SID_A/SID_B not in remote board"; fi

# 2. CAPTURE SUCCESS — the live pane text crosses the wire and contains the unique nonce.
CAP="$(SPEX session capture "$SID_A" 2>/dev/null)"; rc=$?
if [ $rc -eq 0 ] && grep -q "nonce=$NONCE" <<<"$CAP"; then ok "capture: SID_A pane nonce crossed the wire"; else no "capture: SID_A nonce missing (rc=$rc)"; fi

# 3. FAIL≠EMPTY (offline) — a known-but-tmux-dead session is a LOUD 409, not blank+exit0.
out="$(SPEX session capture "$SID_B" 2>&1)"; rc=$?
if [ $rc -ne 0 ] && grep -qi offline <<<"$out"; then ok "fail≠empty: offline session → non-zero + 'offline'"; else no "fail≠empty: offline not distinguished (rc=$rc out=$out)"; fi

# 4. FAIL≠EMPTY (unknown) — a bogus id is 404 → exit 2 'no such session', never blank.
out="$(SPEX session capture 00000000-dead-dead-dead-000000000000 2>&1)"; rc=$?
if [ $rc -eq 2 ] && grep -qi "no such session" <<<"$out"; then ok "fail≠empty: unknown id → exit 2 + 'no such session'"; else no "fail≠empty: unknown not distinguished (rc=$rc out=$out)"; fi

# 5. NO BACKEND — pointing at a dead port fails LOUD (never a silent local fallback / blank success).
out="$(SPEXCODE_API_URL=http://127.0.0.1:59997 "$SPEX_CLI/node_modules/.bin/tsx" "$SPEX_CLI/src/cli.ts" session capture "$SID_A" 2>&1)"; rc=$?
if [ $rc -ne 0 ] && grep -qi "no backend reachable" <<<"$out"; then ok "no-backend: fails loud (no silent fallback)"; else no "no-backend: did not fail loud (rc=$rc out=$out)"; fi

# 6. SEND FAIL-LOUD — dispatch reaches the remote backend, which can't confirm a real claude accept → 502 → exit 1.
out="$(SPEX session send "$SID_A" 'remote hello' 2>&1)"; rc=$?
if [ $rc -ne 0 ] && grep -qi "dispatch failed" <<<"$out"; then ok "send: dead dispatch surfaces loud (no silent 200)"; else no "send: did not fail loud (rc=$rc out=$out)"; fi

# 7. PROMPT over the wire — the originating prompt (with nonce) is readable from the client.
out="$(SPEX session prompt "$SID_A" 2>/dev/null)"
if grep -q "$NONCE" <<<"$out"; then ok "prompt: originating prompt crossed the wire"; else no "prompt: not retrieved"; fi

# 8. WATCH over the wire — a bounded watch must emit a 'launched' line for SID_A (proves the poll source is the
#    remote backend, not a local board).
WLOG="$(mktemp)"
( SPEX watch --interval 1 >"$WLOG" 2>&1 & wpid=$!; sleep 4; kill "$wpid" 2>/dev/null ) >/dev/null 2>&1
if grep -q "$SID_A" "$WLOG"; then ok "watch: streamed SID_A from the remote backend"; else no "watch: SID_A not seen (got: $(tr '\n' '|' <"$WLOG" | head -c 200))"; fi
rm -f "$WLOG"

echo "== $PASS passed, $FAIL failed =="
[ $FAIL -eq 0 ]
