---
title: platform-support
status: active
hue: 330
desc: SpexCode's supported runtime is POSIX — Linux, macOS, or Windows via WSL2. The session runtime rests on tmux/bash/AF_UNIX with no native-Windows analog, so a non-POSIX host is detected and fails loudly toward WSL2 instead of crashing cryptically.
code:
  - spec-cli/src/runtime-guard.ts
  - spec-cli/src/runtime-guard.test.ts
related:
  - spec-cli/bin/spex.mjs
  - spec-cli/src/cli.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/harness.ts
---
# platform-support

SpexCode's supported runtime is **POSIX**: Linux, macOS, or Windows **via WSL2**. Native Windows is out of
scope for the **session runtime** — deliberately, not a gap waiting to be filled. The whole posture is one
honest line: *on a non-POSIX host, run under WSL2 — and say so, instead of crashing.*

## why native Windows is out of scope

The read-only half of the tool (the spec↔code graph, lint, the board) is pure Node and runs anywhere the
launcher does. What does not port is the **session runtime**, because its substrate is Unix primitives with
no native-Windows analog:

- **tmux is load-bearing for four roles at once** — the durable detached process holder, the PTY, the
  capture-pane scrollback source, and the multi-client reattach fabric. Windows ConPTY offers only a PTY
  bound to one owning process; it is not a session store you can list, re-probe, and reattach to.
- **every agent launch and harness event runs through hand-written bash** — the launch scripts, the dispatch
  and Stop hooks, the materialized settings commands — a dialect no native Windows shell speaks.
- **the control channel is filesystem-path AF_UNIX sockets** — the rendezvous socket, the codex app-server —
  a Unix address family, not a Windows named pipe.

A half-working native port would have to re-implement all three behind product code that today rightly does
not know whether its transport is a socket. That is a large, lossy port for a platform that already has a
genuine Linux kernel one command away.

## WSL2 is the Windows path (proven on real hardware)

WSL2 is not an emulation shim — it is a real Linux kernel, so all three blockers simply disappear inside it.
Proven live on the fleet's Windows box (windows-chole, kernel `6.18-microsoft-standard-WSL2`): tmux, bash,
git, and AF_UNIX sockets all work, and `nvm install 22` supplies the pinned Node the distro's own package is
too old to give. WSL2's mirrored networking makes the dashboard's ports reachable at `localhost` from the
Windows browser. So the supported Windows story is: **install WSL2, run SpexCode inside it** — the same POSIX
runtime as Linux, not a second codepath.

## fail loudly, never cryptically

Two mechanisms keep the contract honest at the boundary rather than only in prose:

- **The launcher stays cross-platform** so the read-only commands reach a Windows user at all: it resolves
  tsx's JS entry and runs it through `node`, never the `.bin/tsx` shim (an unspawnable sh script on Windows) —
  the tsx-resolution rule owned by [[packaging]]. That is what turns the reported `spawn …\.bin\tsx ENOENT`
  crash of `spex init` into a command that simply works.
- **The session runtime is gated.** `spex serve` — the entry to the session runtime on a host — checks for
  its load-bearing primitive (tmux) and, if absent, prints ONE actionable line and exits before any cryptic
  downstream failure: point a Windows user at WSL2 (no POSIX analog exists), and a bare POSIX host that merely
  lacks tmux at installing it. The gate keys on the missing **primitive**, not on the OS name, so it is honest
  for both; and it is narrow — only the session-launch path is walled, never the read-only CLI.

This is the same shape as [[merge-tooling-resilience]]: the single launcher entry degrades an expected
adverse condition — there a mid-merge tree, here a non-POSIX host — into one legible line and a distinct exit
code, never a stacktrace.
