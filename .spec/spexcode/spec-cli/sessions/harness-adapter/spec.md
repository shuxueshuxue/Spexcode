---
title: harness-adapter
status: active
hue: 280
desc: One seam between SpexCode and the coding-agent harness (Claude Code, Codex, …). Every harness-specific fact lives behind a single Adapter interface with one impl per harness; product code never branches on which harness it is.
code:
  - spec-cli/src/harness.ts
  - spec-cli/src/harness.test.ts
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
  dispatcher (`.claude/settings.json` vs `.codex/hooks.json`). Codex lacks Notification + StopFailure: codex's
  canonical hook event set (its `HookEventName` enum, codex 0.142.3) is preToolUse/permissionRequest/postToolUse/
  preCompact/postCompact/sessionStart/userPromptSubmit/subagentStart/subagentStop/stop — there is no idle/
  attention "notification" event and no failed-stop event, so those two claude-only events are genuinely absent,
  not unimplemented.
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
  `ownsRendezvous` instead of hard-wiring the claude rendezvous socket. `liveness(rec, tmuxAlive)` answers "is
  this session's agent ready?": **claude** = the tmux window is up AND its reclaude rendezvous socket exists
  (the socket is the truth claude is alive — the pane command is the wrapper/shell while claude runs as its
  child); **codex** = the tmux window is up AND this session's **per-session** Codex app-server Unix socket
  exists (one app-server per session, keyed on the session store dir, so the socket's existence proves this
  pane's transport is up). That app-server holds exactly ONE thread — the visible TUI's own — so the session's
  native thread id is read DETERMINISTICALLY off `thread/loaded/list` (the [[harness-session-id]] hook captures it
  via `spex codex-thread`; no rollout-file scan, no cwd guess, no "which of N threads"). The
  app-server `--listen unix://<sock>` endpoint is a WebSocket at path `/rpc` (the same upgrade the `--remote`
  TUI performs); delivery speaks WebSocket JSON-RPC over that Unix socket directly — NOT `codex app-server
  proxy` (a dumb byte relay that performs no HTTP upgrade, which the server rejects).
  `deliver(rec, text)` sends a
  follow-up prompt and reports whether it landed: **claude** through the rendezvous socket (inject + submit +
  CONFIRM accepted — loud failure on a missing/dead socket, no silent fallback); **codex** through the same
  Codex app-server JSON-RPC control plane the visible TUI uses — the visible TUI's thread is ALREADY loaded in
  that server (launched `--remote`), so we do NOT `thread/resume` it (that re-loads a thread the live pane owns).
  The handshake is `initialize → initialized → thread/loaded/list` (PROVE the captured thread is the one the
  pane shows) `→ thread/read{includeTurns}`. That read decides the inject: if a turn is **in progress** (the
  thread has an `inProgress` turn), `turn/steer` injects the message INTO that live turn — the model reacts
  mid-turn ("inserted right after the running tool call completes"), it is NOT queued for after the turn ends;
  if the thread is **idle**, `turn/start` opens a new turn. `turn/steer` REQUIRES the active turn id as its
  `expectedTurnId` precondition (read from the thread, never from SpexCode's possibly-stale session status); a
  turn that ends in the read→steer window fails that precondition and is retried as a `turn/start`. Either way
  the app-server response confirms it landed. There is NO tmux prompt typing fallback for Codex: typed keys can
  truncate and can only prove tmux accepted input, not that Codex accepted a
  turn. `resumeArg(rec)` is the relaunch tail `reopen()` hands `launch()`: **claude** `--resume <id>` (the SAME
  conversation, the id we pinned); **codex** `resume <thread-id>` (codex's own `resume` subcommand) once the
  real thread id has been captured, resuming the SAME conversation, else a fresh TUI on the same worktree/record. sessions.ts's `liveness()`/`isOccupying()`/`sendKeys()`/
  `reopen()`/`waitForReady()` all route through these adapter methods — there is no socket hard-wire and no
  `if (codex)` left in the runtime path; the rendezvous-socket path + its `replyViaSocket` round-trip MOVED into
  `harness.ts` as the claude adapter's `deliver`/`liveness` implementation, while Codex's app-server launch and
  JSON-RPC turn delivery live in the Codex adapter.

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
path-like token (`sed -n 1p f.ts` → `f.ts`). A patch can bundle SEVERAL `*** … File:` markers (a multi-file
edit), so `hp_code_path` emits ALL touched paths — one per line — and every consuming hook iterates them
([[spec-first]] nudges if ANY is non-spec code; [[spec-of-file]] annotates EACH governed code file). The shared
`hp_field` reads a top-level JSON string value as a real JSON string: the close quote is the first UNESCAPED `"`,
so a `command` carrying a quoted literal (`sed -n "1,5p" f.ts`) is captured whole, not truncated at the inner
quote. `hp_is_ask` maps Codex's `request_user_input` (and Claude's `AskUserQuestion`) onto the question capture.
So [[spec-first]], [[spec-of-file]], and mark-active fire on Codex, not just Claude. The session-id + global-store
resolution every handler repeated is folded into the same helper. The same mirror exposes
`hp_harness_session_id`: Claude returns nothing because its pinned id already is the governed record id; Codex
returns the payload `session_id` when `SPEXCODE_SESSION_ID` points at the governed SpexCode record, letting the
generic `harness-session-id` hook store Codex's real app-server thread id without the dispatcher or lifecycle
hooks branching on Codex.

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
- **no rendezvous** (`ownsRendezvous:false`): codex has no reclaude control socket, so SpexCode uses Codex's
  own app-server. Each SpexCode project has one project-scoped `codex app-server --listen unix://<project sock>`
  under the same global project runtime dir as the hook manifest, and every dashboard-launched Codex TUI starts
  as `codex --remote unix://<project sock> ...`; follow-up delivery opens a WebSocket to the same socket's
  `/rpc` endpoint and sends JSON-RPC. The app-server is a shared control plane, not a session identity; session
  routing is solely the Codex thread id. That thread id is still Codex-minted and unpinnable at launch, so the
  governed record keeps SpexCode's id as `session_id` and stores the real Codex id in `harness_session_id`,
  captured from the Codex rollout `session_meta`. If `harness_session_id` is missing, delivery fails loud
  instead of guessing from `thread/loaded/list`, because one app-server can host several sessions and several
  `spexcode serve` processes must never cross-send. Explicit `--remote` is the default because it deterministically binds the
  pane and backend control to the project app-server; Codex's implicit default-socket reuse is a useful future
  supervisor mechanism but too conditional and too global to be this launch contract.
