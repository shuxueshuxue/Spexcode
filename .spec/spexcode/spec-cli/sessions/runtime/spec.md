---
title: runtime
status: active
hue: 280
desc: The per-worktree `.session/` directory — every harness-written runtime artifact under one ignored, mergeable-clean folder, with a bounded compat shim for legacy flat files.
code:
  - spec-cli/src/layout.ts
  - spec-cli/src/sessions.ts
---

# runtime

## raw source

A session worktree is also where the harness scribbles its own bookkeeping — the lifecycle record, the
originating prompt, a queued session's launch prompt, the generated hook settings, the launch script, the
isolated project `CLAUDE.md`. None of it is the agent's spec/code work, and all of it must vanish with the
worktree. So it lives under **one** ignored directory, `.session/`, instead of a scatter of differently-named
dotfiles in the worktree root — the root stays clean, the runtime is one `rm -rf`, and a new per-session
file never reopens "where does this go".

## expanded spec

Every per-worktree runtime artifact lives under `.session/`:

| path | legacy flat name | written by |
|---|---|---|
| `.session/state` | `.session` | `readSessionFile` / `writeSessionFile` — the lifecycle record ([[state]]) |
| `.session/prompt` | `.session-prompt` | the originating human ask ([[launch]]) |
| `.session/launch` | `.session-launch` | the deferred launch prompt of a still-queued session ([[launch]]) |
| `.session/hooks.json` | `.spex-hooks.json` | the per-session Claude Code hooks (`writeSettings`) |
| `.session/launch.sh` | `.spex-launch.sh` | the whole launch invocation (`launchScript`) |
| `.session/claude.md` | `CLAUDE.spexhidden.md` | the moved project `CLAUDE.md` ([[launch]]'s isolation) |

`layout.ts` owns the seam — the one place that knows where these sit: `RUNTIME_DIR` (`.session`),
`statePath(dir)` (the state file), and `runtimePath(dir, name, legacy)` (a sidecar). `sessions.ts` writes
through `runtimeDir(path)` (mkdir-and-return) and reads through those resolvers; `isRuntimePath` keeps the
whole dir out of the Stop-gate's dirty count — belt-and-suspenders to `.gitignore`, since an adopted
project's ignore list may differ. The lowercase `claude.md` in a dot-dir is invisible to Claude Code's
`CLAUDE.md` auto-discovery, which retires the old `.spexhidden` rename.

**Compatibility — a bounded shim, removed once drained.** Pre-refactor worktrees wrote the flat dotfiles,
and the Stop / PreToolUse hooks are SHARED from the main checkout, so the layout flips for every in-flight
session the instant this merges. The readers therefore resolve the folder path but fall back to the flat
file while `.session` is still a FILE — the shell hooks with `[ -d .session ] && f=.session/state || f=.session`,
the TS with `statePath` / `runtimePath`. A write to `state` follows the same resolution, so a legacy session
keeps updating its flat file rather than splitting state across two places. Once no flat-layout worktree
remains, drop the fallbacks: the `LEGACY_RUNTIME` set and `runtimePath`/`statePath` legacy branches, the hook
`[ -d .session ]` lines, and the legacy `.gitignore` entries.
