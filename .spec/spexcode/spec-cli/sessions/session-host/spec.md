---
title: session-host
status: pending
hue: 285
desc: The session HOST is an adapter boundary like the harness — tmux-host today, byte-identical; process-host for hosts without tmux, offering headless adapters only.
related:
  - spec-cli/src/session-tmux.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/graphStream.ts
  - spec-cli/src/session-record.ts
  - spec-cli/src/harness.ts
  - spec-cli/src/runtime-guard.ts
  - spec-cli/src/runtime-ownership.ts
  - spec-cli/src/pty-bridge.ts
---
# session-host

[[harness-adapter]] enforces the project's platform-boundary principle along one axis: product code never knows
whether the agent is Claude, Codex or pi. The same principle was never applied to the other axis — **what
container a session runs in** — and so tmux is assumed everywhere: [[session-tmux]] is the declared transport,
but `sessions.ts`, the liveness pollers in `graphStream.ts`, the quarantine witness in `session-record.ts`, the
attach routes and the harness `liveness()` signature all know the host is tmux. Even the headless adapters run
their controller inside a tmux window. `runtime-guard.ts` therefore refuses the whole session runtime on any host
without tmux, which is every native Windows machine.

**tmux plays five roles, and only two are about terminals.** (1) Process host: the agent outlives the backend,
which hot-reloads on every source change. (2) Name registry and base liveness: the window's existence. (3)
Attachable terminal: `pty-bridge.ts` streams a tmux client to the dashboard's xterm. (4) Last-resort raw input:
`send-keys`. (5) Witness and accounting: quarantine's exact tmux witness, `host-resources`' server accounting.
Roles 1, 2 and 5 are session-host concerns implemented on tmux by history; 3 and 4 are genuinely TUI-only.

**One `SessionHost`, chosen per backend at boot.** `launch(id, cmd, env)` detached from the backend's lifetime;
`alive(id)`; `stop(id)`; `witness(id)`; and the optional `attach(id)` and `sendKeys(id)`. Product code — sessions,
pollers, records, routes — calls the host and never a tmux verb. Two implementations:

- **tmux-host** (POSIX): today's behaviour, all five roles, and the proof of this refactor is that it is
  byte-identical — same socket, same probes, same timeouts, same witness strings — on the fleet's Linux and macOS
  deployments.
- **process-host** (any OS): spawns detached (`detached`, `windowsHide`), proves liveness by pid plus start token —
  `runtime-ownership.ts` already mints that identity for backends — and offers that identity as the witness. It
  has no `attach` and no `sendKeys`, and a host without them lists **only headless adapters** in its harness
  inventory. That is the rule made true at the right layer: not "disable the TUI on Windows" as a branch, but
  "this host cannot attach, so only adapters that need no attaching are offered."

`runtime-guard.ts` stops being a refusal and becomes host selection: tmux present → tmux-host; absent → process-host
with its reduced inventory, said plainly. The control sockets' paths become a host concern too: unix paths on
POSIX, named pipes on Windows. A `[[host-facts]]` reader shows which host is active and why.

The lane runs in two phases with a landing between them: extract the boundary with tmux-host alone and prove
parity; then add process-host and prove a headless session's full loop on a host with no tmux.
