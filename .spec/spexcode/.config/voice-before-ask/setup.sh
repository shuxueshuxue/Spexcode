#!/usr/bin/env bash
# @@@ voice-before-ask setup (setup surface) - register the voice MCP so the system-surface rule
# ("speak a question aloud before asking the human") is backed by a real voice/say tool. Idempotent:
# no-op when `voice` is already registered; never touches any other MCP server.
set -euo pipefail

SERVER="${VOICE_MCP_SERVER:-$HOME/Codebase/claude-voice-mcp/server.mjs}"

# Already registered → nothing to do. `claude mcp get` exits 0 iff a server by that name exists.
if claude mcp get voice >/dev/null 2>&1; then
  echo "voice-before-ask: voice MCP already registered — no-op."
  exit 0
fi

# Fail loud rather than register a path that can't run. This is the repair entrypoint: the rule is
# unbacked until the voice MCP source is present.
if [ ! -f "$SERVER" ]; then
  echo "voice-before-ask: voice MCP source not found at $SERVER" >&2
  echo "  install it (see ~/Codebase/claude-voice-mcp) or set VOICE_MCP_SERVER, then re-run." >&2
  exit 1
fi

# Add only the `voice` server, user-scoped. `claude mcp add` writes a single named entry, leaving
# every other registered MCP untouched.
claude mcp add voice --scope user -- node "$SERVER"
echo "voice-before-ask: registered voice MCP (user scope) → node $SERVER"
