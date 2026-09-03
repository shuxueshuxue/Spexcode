---
title: desktop-login-path
status: pending
hue: 30
desc: A GUI launch hands the shell a PATH that never sourced the user's profile; the shell repairs its own environment before it spawns the gateway, so host facts describe the machine and not the launcher.
code:
  - spec-desktop/login-path.js
related:
  - spec-desktop/main.js
  - spec-desktop/login-path.test.js
  - spec-cli/src/host-facts.ts
---

A process started from a graphical session inherits an environment that never ran the user's shell profile.
launchd hands a macOS application `/usr/bin:/bin:/usr/sbin:/sbin`; a Linux `.desktop` entry is no better. Every
tool a developer installs lands outside that set — Homebrew under `/opt/homebrew/bin`, a Node version manager
under `~/.nvm/versions/node/<v>/bin`, an agent CLI under `~/.local/bin` or its own `~/.<tool>/bin`.

This is not cosmetic, because the product resolves tools **through PATH**. [[host-facts]] answers "is tmux here?"
and "does this launcher's command exist?" by running `which`, so under a GUI launch every answer is `missing` and
every launcher reads `broken`, while the same machine's terminal has all of them. The absence of tmux also decides
the session host: a machine that really has tmux is reported as a `process-host` that can only run headless
adapters. Credential detection reads files instead, so it keeps working — which is what produces the
self-contradicting host card `codex: missing · logged in`, a tool that is somehow authenticated and absent at once.
That pair is the signature of this defect, not of a half-installed CLI.

**The shell repairs its own environment, once, before it spawns anything.** It is the process that was started
without a profile, so it is the process that owes the repair; nothing downstream should learn that its parent may
have been double-clicked. The repair asks the user's own login shell what PATH it has (`$SHELL -ilc`, the answer
announced after a marker so an rc file's banner cannot be mistaken for a path), then merges: login directories
first because they carry the version manager the user actually runs, and every inherited directory kept, so a shell
that resolves nothing can never leave the app with less than it started with.

The probe is paid only where it buys something. A shell-launched app already carries the profile PATH and is left
alone; the tell-tale of a GUI launch is that **nothing** outside the minimal set is present. Windows is never
probed — its PATH comes from the registry and reaches a GUI launch intact.

A failed or silent probe is reported, never swallowed: the shell logs which shell failed and what PATH remains.
A bare-looking host must be a statement about the probe, not a silent lie about the machine.
