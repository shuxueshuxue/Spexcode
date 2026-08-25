---
title: claude-rendezvous
status: active
hue: 280
desc: The Claude adapter's runtime transport — the per-session rendezvous socket's name and home, connect-probe liveness, the atomic reply/repaint delivery protocol, the background-fork handoff, and `--resume`.
code:
  - spec-cli/src/harness.ts#claudeHarness
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/harness.test.ts
  - spec-cli/src/session-timeline.test.ts
---

# claude-rendezvous

The Claude Code adapter row of [[harness-adapter]] owns one runtime transport: reclaude's per-session rendezvous
socket. Everything below is what that transport guarantees — where the socket lives and why, what counts as a live
agent, how a message is handed over so a retry can never double-deliver, and how a session that Claude moved to a
background job is still reached. The materialization half of the row (shim, contract file, artifact dirs) is the
adapter seam's shared contract and is not restated here.

**Liveness.** The tmux window is up AND a live LISTENER is on its reclaude rendezvous socket
  (`socketLive`) — a listener the OS accepts, **not** the mere existence of the socket FILE. This matters
  because a crashed/killed claude does **not** unlink its unix-socket path, so the old `existsSync(rvSock)` read
  a DEAD pane as `online` for as long as that stale file lingered — the incident's "dead pane stuck `working`
  for 30+ minutes". A `connect()` is the honest test: a live claude accepts it, a stale file refuses it
  (ECONNREFUSED, instant), an absent file ENOENTs (instant) — so a dead claude reads `offline` within seconds.
  The rendezvous pathname is a launch-time fact, stamped beside the session record so future derivations cannot
  strand an existing worker. A NEW rendezvous owner gets its socket under SpexCode's own durable home — normally
  `<home>/.spexcode/s/<16hex>/c` (or that user's `SPEXCODE_HOME`) — never an OS temporary-cleanup namespace.
  The 16 hex digits are one fixed digest of runtime scope + session identity; the leaf is the constant `c`, so
  neither raw session id nor project name becomes pathname text, while two worlds holding the same session id
  still cannot share a listener. The directory is created `0700`. This satisfies BOTH constraints at once:
  the home-owned store survives host temporary cleanup, and the fixed 31-byte suffix leaves a known byte budget
  below macOS's ~104-byte `sun_path` cap. The owner calculates its UTF-8 path bytes during session creation and
  refuses loudly before a worktree/window/bind when the result is not `< 104`; it also checks before stamping.
  That prevents the deceptive `EINVAL` state where an inode exists but every `connect()` fails and a healthy
  worker reads `unknown`. An old stamped `/tmp/...` value remains that worker's address forever: readers use the
  stamp unchanged, with no flag day. This rule belongs ONLY to `ownsRendezvous` adapters, whose endpoint is the
  session's identity; it does not change Codex's deliberately project-shared app-server, whose endpoint routes
  many threads and intentionally carries no session identity.
  (The pane command is always the wrapper/shell while claude runs as its child, so claude still IGNORES the pane
  probe.) 

**Delivery.** The adapter writes one atomic
  chunk containing `{type:reply,text,mid}` followed by `{type:repaint}`. Its rendezvous daemon owns one
  connection at a time; a concurrent liveness probe can destroy a connection before parsing. `repaint-done`
  proves the preceding reply was parsed, while a close/ECONNRESET/EPIPE before it proves the whole chunk was
  discarded and is safe to retry with the same `mid` (bounded attempts with jitter). An open connection that
  reaches the generous wall without a response is treated as busy, not lost, so active turns do not become
  false failures; explicit rejection or shutdown remains loud. Claude's
  **`deliveryBlockedBy(paneText)`** predicate recognizes the sessions panel ("← for agents"), which swallows
  injected replies. It merely suppresses that known-useless poke: the line is already delivered and the reader
  shows it at the next boundary. Codex has no such predicate (its poke is app-server JSON-RPC; pane state is
  irrelevant). 

**Resume.** `--resume <id>` is appended straight to the `claude` command — the SAME conversation, the id SpexCode pinned at launch.

**Fork handoff.** Claude interactive delivery has one measured transport handoff: a session moved to a Claude background job is a
fork. When the successor's hook has persisted its exact Claude session id as `moved`, the adapter resolves the
roster worker by that exact `worker.sessionId`; without a readable matching stamp, it falls back to the roster's
`dispatch.launch.mode=resume`, `dispatch.launch.fork=true`, and source transcript path. In either case the roster
supplies the live rendezvous socket and current `rvAuth`, so the adapter sends the `role`/`auth` handshake before
the ordinary `reply` frame. A roster entry whose socket cannot accept the handoff is stale transport, not an
override forever: retry the source session's stamped launch-time socket before leaving the durable message owed.
The roster root is the launched source process's own `CLAUDE_CONFIG_DIR` field when
that still-live process exposes it, then the backend environment/default fallback: a backend must not silently
assume its own Claude home is the launcher's. It reads no other process environment fields. The adapter never
guesses a token, prints one, or changes the pane/raw-key transport. A missing or unreadable fork entry preserves
the normal launch-time socket path; the durable queue remains the acceptance boundary in either case.
