---
title: platform-support
status: active
hue: 330
desc: SpexCode's supported runtime is POSIX — Linux, macOS, or Windows via WSL2, the recommended zero-effort path today. Native Windows is deferred, not impossible: native tmux-like multiplexers now exist, and the one real remaining gap is the control-mode live-terminal bridge. A non-POSIX host is detected and fails loudly toward WSL2 instead of crashing cryptically.
code:
  - spec-cli/src/runtime-guard.ts
related:
  - spec-cli/bin/spex.mjs
  - spec-cli/src/cli.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/runtime-guard.test.ts
  - spec-cli/src/harness.ts
---
# platform-support

SpexCode's supported runtime is **POSIX**: Linux, macOS, or Windows **via WSL2** — the recommended path, and
today the only one. Native Windows is **deferred, not impossible**: not built yet, and the paragraphs below
name what decides it. The posture: *on a non-POSIX host, run under WSL2 — and say so, instead of crashing.*

## native Windows is deferred, not out of scope

The read-only half of the tool (the spec↔code graph, lint, the board) is pure Node and runs anywhere the
launcher does. The **session runtime** is built on Unix primitives — but the old claim that those have *no
native-Windows analog* is no longer true. Native terminal multiplexers now exist: psmux (native ConPTY,
PowerShell/cmd, flag-compatible with most of the tmux commands the session runtime issues), Zellij-native,
wmux (a ConPTY agent-terminal daemon for Claude Code/Codex), and wezterm-mux. The bulk of the tmux substrate
now has a real native candidate.

What keeps native Windows deferred is **one deciding fidelity gap**, plus two lesser costs a mux swap does
not pay:

- **The deciding gap — the live-terminal bridge rides tmux control mode.** The browser Sessions console
  ([[session-console]]) streams over `tmux -CC`, tmux's structured control-mode protocol. No native multiplexer is
  confirmed to speak it, so a native port must **rewrite that live streaming** — poll capture-pane, or attach
  another way. That rewrite, not a config swap, is the real cost.
- **The two lesser costs.** A mux swap keeps the hand-written bash launchers and hooks (native Windows still
  needs git-bash on PATH or a Node rewrite), and the filesystem-path AF_UNIX rendezvous socket becomes a
  Windows named pipe — an adaptation, not a wall.

Deferral is a considered call, not neglect: Anthropic's own Claude Code declined the identical request
(native Windows tmux agent-teams via psmux) as *not planned* and hit harness-level Windows quirks — this is
a real project to land, not a switch to flip.

The clean path, **if and when** native is pursued, is to extract a **session-holder** interface (hold /
list / capture / send / attach) so tmux, psmux, or wmux become pluggable backends — turning "port to Windows"
from a scattered rewrite into "write one backend." The intended direction; no code implements it now.

## WSL2 is the Windows path (proven on real hardware)

WSL2 is not an emulation shim — it is a real Linux kernel, so every blocker above disappears inside it.
Proven live on the fleet's Windows box (windows-chole, kernel `6.18-microsoft-standard-WSL2`): tmux, bash,
git, and AF_UNIX sockets all work, and `nvm install 22` supplies the pinned Node the distro's own package is
too old to give. Mirrored networking makes the dashboard reachable at `localhost` from the Windows browser.
So the supported Windows story is: **install WSL2, run SpexCode inside it** — the same POSIX runtime as
Linux, not a second codepath.

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
