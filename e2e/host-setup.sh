#!/usr/bin/env bash
# @@@ host-setup - stand up a REAL spexcode backend + a REAL tmux-backed session on THIS host, isolated in a
# throwaway repo. The pane is a scripted "agent screen" (the refactor under test is the broker/transport, not
# what runs in the pane); a touched rendezvous-socket path makes the session read `working` so `send` reaches
# a real (non-claude) socket and fails LOUD (502) — exactly the dead-dispatch contract. Prints SID_A SID_B NONCE.
# Env: SPEX_CLI (path to spec-cli) · PORT · TMUX_SOCK · WORK (throwaway repo dir) · NONCE
set -euo pipefail
: "${SPEX_CLI:?}"; : "${PORT:?}"; : "${TMUX_SOCK:?}"; : "${WORK:?}"; : "${NONCE:?}"
TSX="$SPEX_CLI/node_modules/.bin/tsx"
TMPD="$(node -e 'console.log(require("os").tmpdir())')"

# tear down any prior run on this socket/port
tmux -L "$TMUX_SOCK" kill-server 2>/dev/null || true
[ -f "$WORK/backend.pid" ] && kill "$(cat "$WORK/backend.pid")" 2>/dev/null || true
rm -rf "$WORK"; mkdir -p "$WORK"; cd "$WORK"

git init -q; git config user.email e2e@spex.local; git config user.name e2e
mkdir -p .spec/project
printf -- '---\ntitle: project\nstatus: active\ncode:\n---\ne2e throwaway.\n' > .spec/project/spec.md
git add -A; git commit -qm init; git branch -M main

uuid() { uuidgen 2>/dev/null | tr 'A-Z' 'a-z' || cat /proc/sys/kernel/random/uuid; }
SID_A="$(uuid)"
SID_B="$(uuid)"

# session A: a live tmux pane (capturable) + a rendezvous-socket FILE so it reconciles to `working`
git worktree add -q -b node/smoke-a .worktrees/smoke-a main
printf 'node: \nsession: %s\nstatus: active\n' "$SID_A" > .worktrees/smoke-a/.session
printf 'e2e prompt for A — monitor me remotely (nonce %s)\n' "$NONCE" > .worktrees/smoke-a/.session-prompt
tmux -L "$TMUX_SOCK" new-session -d -s "$SID_A" -x 200 -y 50
tmux -L "$TMUX_SOCK" send-keys -t "$SID_A" "clear; printf 'AGENT_SCREEN_A nonce=%s\\n' '$NONCE'; cat" Enter
touch "$TMPD/spexcode-rv-$SID_A.sock"   # not a real claude daemon → send dispatch must fail LOUD (502)

# session B: known worktree but NO tmux → must capture as 409 offline (fail, not empty)
git worktree add -q -b node/smoke-b .worktrees/smoke-b main
printf 'node: \nsession: %s\nstatus: active\n' "$SID_B" > .worktrees/smoke-b/.session

# start the backend (cwd = the throwaway repo so it serves THIS repo's worktrees), wait for health
cd "$WORK"
PORT="$PORT" SPEXCODE_TMUX="$TMUX_SOCK" nohup "$TSX" "$SPEX_CLI/src/cli.ts" serve > "$WORK/backend.log" 2>&1 &
echo $! > "$WORK/backend.pid"
for i in $(seq 1 100); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  sleep 0.2
  [ "$i" = 100 ] && { echo "BACKEND_FAILED_HEALTH" >&2; tail -20 "$WORK/backend.log" >&2; exit 1; }
done
echo "SID_A=$SID_A"
echo "SID_B=$SID_B"
echo "NONCE=$NONCE"
echo "READY on port $PORT (tmux -L $TMUX_SOCK)"
