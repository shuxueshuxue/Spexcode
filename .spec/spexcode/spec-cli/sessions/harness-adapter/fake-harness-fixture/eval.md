---
scenarios:
  - name: complete-session-terminal-lifecycle
    tags: [backend-api, cli]
    description: >-
      Start an isolated SpexCode backend with `spec-cli/test/fixtures/fake-claude` resolving as its claude
      launcher, then run `npx tsx spec-cli/test/session-terminal-fixture.ts` against its URL. The runner uses
      the real POST session route, polls the board detail, opens the terminal WebSocket, responds to application
      ping with pong, sends one rendezvous control marker, observes the marker and fixed-rate fake output through
      the PTY bridge, closes the socket and calls the real close route, then inspects tmux, the derived rendezvous
      socket, the process tree, worktree, and branch.
    expected: >-
      The external fixture exits 0 only after POST creates one session, derived liveness is online and backed by a
      live rendezvous listener, the terminal route upgrades with HTTP 101, real PTY bytes contain READY/TICK and
      the control reply marker, and close leaves no tmux session, rendezvous socket, fake process, worktree, or
      branch. No session.json is edited and no model or network is used.
    code: spec-cli/test/session-terminal-fixture.ts
---

# fake-harness-fixture — eval

This scenario is a dynamic backend/terminal proof. Its evidence is the runner transcript, which records the real
HTTP, rendezvous, WebSocket, PTY, and teardown observations rather than a unit-level imitation.
