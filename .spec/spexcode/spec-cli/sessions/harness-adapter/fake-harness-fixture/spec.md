---
title: fake-harness-fixture
status: active
hue: 280
desc: A repository-local no-model fixture that drives the managed session, rendezvous, terminal WebSocket, PTY, and close cleanup path through real external surfaces.
code:
  - spec-cli/test/session-terminal-fixture.ts
related:
  - spec-cli/test/fixtures/fake-harness.mjs
  - spec-cli/test/fixtures/fake-claude
  - spec-cli/src/session-terminal-fixture.test.ts
  - spec-cli/test/terminal-socket-lifecycle.ts
  - spec-eval/src/matrix.ts
---

# fake-harness-fixture

## raw source

SpexCode needs one deterministic, no-model worker for proving the managed terminal path without credentials or a
network. This fixture is an external command boundary: a caller starts a backend with the fixture's `claude`
launcher on `PATH`, then the runner uses only the public HTTP/WebSocket session routes plus local tmux observation.

The fake launcher emits a fixed-rate, marker-bearing stream on its real PTY and binds the same per-session
rendezvous socket path the claude adapter expects. It accepts the existing line-JSON control messages, confirms
`reply` + `repaint` with `repaint-done`, and answers a small `ping` message for deterministic control probes. The
runner proves the complete user-shaped chain: `POST /api/sessions` creates the record, the board derives
`online` from the live rendezvous listener, `/api/sessions/:id/socket` completes HTTP `101`, the PTY bridge carries
the fake stream and a rendezvous-delivered control marker, and `POST /api/sessions/:id/close` removes the tmux
session, rendezvous socket, worker process, worktree, and branch.

The fixture never edits `session.json`, invents a product route, invokes a real model, or contacts the network.
The runner is intentionally version-tolerant at the create boundary: it uses the named `launcher` field when
available and retries without that field only when an older backend explicitly reports it as unknown. The same
command can therefore drive a current or historical backend whose existing claude launcher is pointed at the fake
command by environment/configuration.
