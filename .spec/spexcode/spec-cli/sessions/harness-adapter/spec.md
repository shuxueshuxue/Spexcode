---
title: harness-adapter
status: pending
hue: 280
desc: One seam between SpexCode and the coding-agent harness (Claude Code, Codex, …). Every harness-specific fact lives behind a single Adapter interface with one impl per harness; product code never branches on which harness it is.
related:
  - spec-cli/src/slash-commands.ts
  - spec-cli/src/materialize.ts
  - spec-cli/src/sessions.ts
---

# harness-adapter

## raw source

SpexCode integrates with whatever coding-agent harness the user runs — today Claude Code and Codex,
tomorrow others. Their differences are real and many. The rule (the project's own platform-boundary
principle): **platform differences live at an adapter boundary; product semantics never know which harness
is in play.** So there is ONE `Harness` interface, ONE implementation per harness, and an `if (codex)` /
`if (claude)` branch ANYWHERE in product code (materialize, dispatch, sessions, board, slash) is forbidden —
that branching belongs to the harness detector and the adapter only.

## expanded spec

The harness is resolved ONCE (per launch from the launcher's choice, or per hook from a payload/env marker)
into the matching adapter; everything downstream calls the adapter. The Adapter owns exactly these
divergence points — its whole surface:

- **slashCommands()** — the `/` menu, computed the way THAT harness computes its own (Claude: a captured
  built-in set + `.claude/commands/**` + skills; Codex: its built-ins + `~/.codex/prompts/**` + plugin
  commands). Decoupled from execution — see [[slash-commands]] (today Claude-only; becomes the Claude impl).
- **events / shim** — which lifecycle events to bind, and the per-harness hook shim that points each at the
  dispatcher (`.claude/settings.json` vs `.codex/hooks.json`). Codex lacks Notification + StopFailure.
- **contract file(s)** — where the `surface: system` block is materialized ([[harness-delivery]]): Claude
  `./CLAUDE.md` or `./.claude/CLAUDE.md`; Codex ONLY the repo-root `./AGENTS.md`.
- **trust** — make a user-self-launched agent run the hooks with zero prompts: Codex writes the
  deterministic `trusted_hash` into the global `~/.codex/config.toml`; Claude relies on folder-trust (often
  nothing). The codex-rs hash algorithm is reverse-engineered + pinned.
- **payload accessors** — read `session_id`, the edited-file path (Claude `tool_input.file_path` vs Codex
  `apply_patch` command — Codex has NO `file_path`), and notification type, from a hook's stdin.
- **launch / sessionId** — the launch command and id model: Claude `claude --session-id <uuid> [--worktree]`
  (caller chooses the id); Codex `codex` with `--yolo`/approval+sandbox (id is codex-assigned, resumed by a
  captured id). The agent-typed CLI resolves its own id via the harness's env (`CLAUDE_CODE_SESSION_ID` / …).
- **worktree** — Claude has a native `--worktree` + `WorktreeCreate`/`WorktreeRemove` hooks; Codex has none
  (SpexCode manages the worktree itself). The adapter exposes whether the harness owns worktrees.

Most of this is **consolidation**, not new behavior: the event/snake maps, the Codex trust writer, and the
shim writers already exist scattered in [[harness-delivery]]'s materialize; `CLAUDE_CMD` in [[sessions-core]];
the Claude `/` menu in [[slash-commands]]. The adapter gathers them under one interface and adds the missing
Codex implementations — chiefly the Codex `/` menu (replicated as Claude's was) and the apply_patch
path-extractor. Sequenced AFTER the global-session-store refactor lands (both touch sessions.ts).
