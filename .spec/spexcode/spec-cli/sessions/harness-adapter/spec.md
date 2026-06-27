---
title: harness-adapter
status: active
hue: 280
desc: One seam between SpexCode and the coding-agent harness (Claude Code, Codex, …). Every harness-specific fact lives behind a single Adapter interface with one impl per harness; product code never branches on which harness it is.
code:
  - spec-cli/src/harness.ts
  - spec-cli/hooks/harness.sh
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

The harness is resolved ONCE into the matching adapter; everything downstream calls the adapter. DETECTION is
not payload-sniffing: each adapter OWNS its shim, and the shim bakes the harness id as the dispatcher's first
argument (`dispatch.sh <id> <Event>`), so `dispatch.sh` exports `SPEXCODE_HARNESS` and a hook subprocess learns
its harness from the shim that wired it — deterministically, never by guessing the payload shape. On the TS
side the harness is the launcher's choice (the dashboard launches `defaultHarness`) or ALL adapters at once
(materialize renders every harness's artifacts). The Adapter owns exactly these divergence points — its whole
surface:

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
- **runtime: liveness + delivery** — the RUNTIME transport, lifted onto the adapter so product code honours
  `ownsRendezvous` instead of hard-wiring the claude rendezvous socket. `liveness(id, tmuxAlive)` answers "is
  this agent up?": **claude** = the tmux window is up AND its reclaude rendezvous socket exists (the socket is
  the truth claude is alive — the pane command is the wrapper/shell while claude runs as its child); **codex** =
  the tmux window is up — the **codex process itself holds the pane**, so tmux presence IS liveness (codex opens
  no control socket). `deliver(id, text)` sends a follow-up prompt and reports whether it landed: **claude**
  through the rendezvous socket (inject + submit + CONFIRM accepted — loud failure on a missing/dead socket, no
  silent fallback); **codex** via `tmux send-keys` typed into the pane it holds, then Enter to submit (no daemon
  ack — best-effort typed delivery; short follow-ups only, ~2KB send-keys truncation caveat). `resumeArg(rec)`
  is the relaunch tail `reopen()` hands `launch()`: **claude** `--resume <id>` (the SAME conversation, the id we
  pinned); **codex** relaunches FRESH (empty tail → a new turn in the same worktree/record) until its real
  thread id is captured (then `resume <thread-id>`). sessions.ts's `liveness()`/`isOccupying()`/`sendKeys()`/
  `reopen()`/`waitForReady()` all route through these adapter methods — there is no socket hard-wire and no
  `if (codex)` left in the runtime path; the rendezvous-socket path + its `replyViaSocket` round-trip MOVED into
  `harness.ts` as the claude adapter's `deliver`/`liveness` implementation.

Most of this was **consolidation**: the event/snake maps, the Codex trust writer, and the shim writers were
scattered in [[harness-delivery]]'s materialize; `CLAUDE_CMD` in [[sessions-core]]; the Claude `/` menu in
[[slash-commands]]. They now live in `harness.ts` (`claudeHarness` / `codexHarness`, gathered in `HARNESSES`),
which materialize loops over and sessions reads through `defaultHarness` — there is no `if (codex)` left in
product code. The genuinely NEW Codex pieces: the Codex `/` menu (taken from the pinned codex-rs source the
same discovered-not-guessed way), and the **tool mapping** that closes the inert-on-codex gap.

Because the hook handlers are pure shell, they cannot import `harness.ts`; `hooks/harness.sh` is its **shell
mirror** (sourced by every handler, exported by `dispatch.sh`). It owns the harness-divergent payload parse.
Codex has NO `file_path`; the touched file lives inside `tool_input.command`, and the tool that carries it
differs by operation: an **edit is its own first-class tool `tool_name:"apply_patch"`** whose command is the
**bare patch envelope** (`*** Update File: <path>` lines, with NO literal `apply_patch` token), while a **read/
shell is `tool_name:"Bash"`** + `tool_input.command`. So `hp_code_path` accepts BOTH tools and `_hp_codex_cmd_path`
detects a mutation by the `*** … File:` markers themselves (not by an `apply_patch` token), else takes the last
path-like token (`sed -n 1p f.ts` → `f.ts`); `hp_is_ask` maps Codex's `request_user_input` (and Claude's
`AskUserQuestion`) onto the question capture. So [[spec-first]], [[spec-of-file]], and mark-active fire on Codex,
not just Claude. The session-id + global-store resolution every handler repeated is folded into the same helper.

## verified codex facts (live round-trip, real codex 0.142.3)

The Codex impl of the adapter must encode these (measured against a real self-launched codex):
- **payload fields**: `session_id`(uuid), `turn_id`, `transcript_path`, `cwd`, `hook_event_name` (CamelCase,
  e.g. `PreToolUse`), `model`, `permission_mode`, `tool_name`, `tool_input`, `tool_use_id`, `prompt`. No `file_path`.
- **`.codex/hooks.json` event keys are CamelCase** (codex fired all 5: SessionStart/UserPromptSubmit/PreToolUse/
  PostToolUse/Stop) — the shim is correct as-is; snake_case is ONLY the trust-hash key format.
- **codex tool model** (corrected against a LIVE apply_patch round-trip — the earlier "everything is Bash"
  reading was wrong for edits): a **read/shell** is `tool_name:"Bash"` + `tool_input.command` (e.g. `sed -n 1p
  f`); an **edit is a distinct tool `tool_name:"apply_patch"`** whose `tool_input.command` is the **bare patch
  envelope** — `*** Begin Patch` / `*** Update File: <path>` / … — carrying NO literal `apply_patch` token and
  NO `file_path`. So the adapter keys the mutation off the `*** … File:` markers (NOT an `apply_patch` token)
  and accepts both `apply_patch` and `Bash` as code-touch tools; otherwise [[spec-of-file]] and an edit-first
  [[spec-first]] are INERT on codex (the first cut had both bugs — proven live, then fixed). The store/dispatch
  layer is NOT implicated (proven under real codex: zero-prompt launch, hooks fire from the global store, the
  governed mark-active flip + governed declare/commit gate + silent non-governed Stop all work live).
- **session-id model** (codex-rs source-verified): codex MINTS its own thread id internally (`Uuid::new_v4`/
  `ThreadId::new`) — there is NO flag/env to pin a NEW session's id (`CODEX_THREAD_ID` is an OUTPUT codex
  injects, not an input; resume takes an existing rollout id). So a dashboard-launched codex session can't have
  its governed record keyed by the harness id the way claude's `--session-id` allows. The adapter's resolution:
  the launcher keys the record by a SpexCode id and exports it as `SPEXCODE_SESSION_ID` into the launch env, and
  every hook resolves THAT first (`hp_session_id`), falling back to the payload id only when unset (self-launch).
  One resolver, both harnesses — claude's exported id equals its payload id, so it's a no-op there.
- **no rendezvous** (`ownsRendezvous:false`): codex has no reclaude control socket, so the adapter's
  `liveness(id, tmuxAlive)` reads codex ONLINE iff its tmux pane is alive (the codex process holds the pane —
  there is no offline-forever socket check to fail), and `deliver()` types the follow-up into the pane with
  `tmux send-keys` + Enter rather than the socket round-trip. The launch model is an INTERACTIVE TUI in tmux
  (the same shape as a user self-launching `codex`, plus `SPEXCODE_SESSION_ID`) — NOT the app-server JSON-RPC
  path (correct but experimental/large, out of scope). `reopen()` relaunches FRESH for codex (its thread id is
  un-pinnable, and the spexcode id is not a codex flag) until that real thread id is captured from the
  SessionStart payload / the `$CODEX_HOME/sessions/**/rollout-*-<uuid>.jsonl` filename — deferred; the MVP
  leaves liveness + initial launch + follow-up delivery working without it.
