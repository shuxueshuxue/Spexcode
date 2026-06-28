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
  dispatcher (`.claude/settings.json` vs `.codex/hooks.json`). The shim's LOCATION is a divergence point too:
  Claude reads `.claude/settings.json` from the worktree, but Codex discovers a LINKED worktree's PROJECT hooks
  from the **ROOT CHECKOUT** — codex-rs rewrites the hooks-config folder of any linked worktree to
  `<repo_root>/<rel-from-checkout-root>/.codex` (`root_checkout_hooks_folder_for_dir`), so a thread whose cwd is
  the worktree root reads `<mainCheckout>/.codex/hooks.json`, NEVER the worktree's own. So the Codex shim + its
  trust materialize at the MAIN checkout (one shared `.codex/hooks.json` for the main checkout and every
  worktree — a per-PROJECT artifact, mirroring the per-project runtime tier); `dispatch.sh` resolves its `proj`
  from the thread cwd, so the one shared shim still gates each worktree correctly. Codex lacks Notification + StopFailure: codex's
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
  (caller chooses the id); Codex `codex` with `--yolo`/approval+sandbox (id is codex-assigned — the backend
  owns it via `thread/start` at launch and resumes by it). The agent-typed CLI resolves its own id via the
  harness's env (`CLAUDE_CODE_SESSION_ID` / …).
- **worktree** — Claude has a native `--worktree` + `WorktreeCreate`/`WorktreeRemove` hooks; Codex has none
  (SpexCode manages the worktree itself). The adapter exposes whether the harness owns worktrees.
- **pane-title semantics** (`paneTitleIsSelfSummary`) — whether the harness's tmux pane title IS the agent's
  own live task self-summary, so the board headline may derive from it. Claude continuously writes a one-line
  task summary into its OSC title → true; Codex sets the title to a spinner glyph + the cwd FOLDER name (not a
  summary) → false, so its headline falls through to the launch-prompt preview rather than showing the folder.
  Consumed by [[session-activity]]'s headline resolver — this capability field is the ONLY harness branch in
  that path (no `if (codex)`).
- **runtime: liveness + delivery** — the RUNTIME transport, lifted onto the adapter so product code honours
  `ownsRendezvous` instead of hard-wiring the claude rendezvous socket. `liveness(rec, tmuxAlive, runtimeDir)` answers "is
  this session's agent ready?": **claude** = the tmux window is up AND its reclaude rendezvous socket exists
  (the socket is the truth claude is alive — the pane command is the wrapper/shell while claude runs as its
  child); **codex** = the tmux window is up AND the **per-PROJECT** Codex app-server Unix socket exists (ONE
  app-server per project, keyed on `runtimeRoot()` — the per-project runtime dir, NOT the session store —
  shared by every worktree's thread; the per-session window presence is the session signal, the socket is a
  project control plane). The session's thread id is NOT discovered at all — the BACKEND OWNS it: at launch it
  `thread/start { cwd: <this worktree> }`s on the shared server (codex resolves that worktree's per-cwd
  context — `AGENTS.md` + skills + project config — by walking the thread cwd, so one project-scoped server
  behaves analogously to a per-worktree claude launch; its PROJECT HOOKS are the one exception, read from the
  root checkout per the events/shim point above) and stores the returned `thread.id` on the governed record as `harness_session_id` — no capture hook,
  no rollout-file scan, no cwd guess. The
  app-server `--listen unix://<sock>` endpoint is a WebSocket at path `/rpc` (the same upgrade the `--remote`
  TUI performs); delivery speaks WebSocket JSON-RPC over that Unix socket directly — NOT `codex app-server
  proxy` (a dumb byte relay that performs no HTTP upgrade, which the server rejects).
  `deliver(rec, text)` sends a
  follow-up prompt and reports whether it landed: **claude** through the rendezvous socket (inject + submit +
  CONFIRM accepted — loud failure on a missing/dead socket, no silent fallback); **codex** through the same
  per-PROJECT Codex app-server JSON-RPC control plane the visible TUI uses, addressing the **owned** thread id
  (the one stored at launch). The handshake is `initialize → initialized → thread/loaded/list` (PROVE our
  thread is loaded) `→ thread/read{includeTurns}`. That read decides the inject: if a turn is **in progress** (the
  thread has an `inProgress` turn), `turn/steer` injects the message INTO that live turn — the model reacts
  mid-turn ("inserted right after the running tool call completes"), it is NOT queued for after the turn ends;
  if the thread is **idle**, `turn/start` opens a new turn. `turn/steer` REQUIRES the active turn id as its
  `expectedTurnId` precondition (read from the thread, never from SpexCode's possibly-stale session status); a
  turn that ends in the read→steer window fails that precondition and is retried as a `turn/start`. Either way
  the app-server response confirms it landed. There is NO tmux prompt typing fallback for Codex: typed keys can
  truncate and can only prove tmux accepted input, not that Codex accepted a
  turn. `resumeArg(rec)` is the relaunch tail `reopen()` hands `launch()`: **claude** `--resume <id>` (the SAME
  conversation, the id we pinned); **codex** `resume <thread-id>` (codex's own `resume` subcommand) on the
  owned thread id — its rollout persists on disk — resuming the SAME conversation, else a fresh TUI on the same
  worktree/record. sessions.ts's `liveness()`/`isOccupying()`/`sendKeys()`/
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
So [[spec-first]], [[spec-of-file]], and mark-active fire on Codex, not just Claude — the shared shim lives at
the main checkout, but its commands run `dispatch.sh` with the thread cwd as `proj`, so each worktree gates
against its own tree even though one project-scoped server (and one shared shim) drives them all. The session-id +
global-store resolution every handler repeated is folded into the same helper (`hp_session_id`, `hp_store_dir`).
There is NO codex thread-id capture hook: the backend OWNS the thread id (it `thread/start`s the thread at
launch and stores the id as `harness_session_id` — see above), so no dispatcher or lifecycle hook branches on
Codex and Claude needs nothing here either (its pinned id already is the record id). But design C's hooks fire
from the SHARED per-project app-server process, whose env carries NO `SPEXCODE_SESSION_ID` — so a governed codex
hook's `hp_session_id` resolves to the payload `session_id`, which is the codex THREAD id, not the SpexCode
record id the store is keyed by. So id→record resolution carries an ALIAS step: when no record sits at the id
directly, find the one record that captured this id as `harness_session_id` (a `grep` over the few session.json
files on the shell hot path — no jq; the typed TS read mirrors it in `readAliasedRawRecord`). This is what lets
the pure-shell `mark-active` re-flip and the ask-capture, plus every shell-to-`spex` lifecycle write, reach the
right record from a thread id alone. The alias needs no cleanup artifact — it lives in the record's own
`harness_session_id`, swept with the record on close. The agent's own interactive `spex session done/park/ask`
calls take the SAME path for the SAME reason: codex runs them in the shared app-server shell (NOT a per-session
pane), so they inherit the FIRST session's baked `SPEXCODE_SESSION_ID` — `envSessionId` ([[portable-layout]])
therefore resolves codex's per-command `CODEX_THREAD_ID` (the acting thread's `sessionEnvVar`) through the same
`harness_session_id` alias BEFORE that contaminated `SPEXCODE_SESSION_ID`, so each thread's declaration lands on
its own record; the hook path and the interactive-CLI path share one harness-aware precedence rule. Claude is
unaffected on both paths: its exported id equals both its payload id and the record key, so the direct hit always
wins and the alias step never runs.

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
  the launcher keys the record by a SpexCode id, stores the codex thread id on it as `harness_session_id`, and a
  hook resolves the effective id as `SPEXCODE_SESSION_ID` first (`hp_session_id`) else the payload id. The catch:
  design C's hooks fire from the SHARED app-server, which has NO `SPEXCODE_SESSION_ID`, so a governed codex hook
  lands on the payload THREAD id — NOT a self-launch, just an env-less process — and id→record resolution then
  ALIASES that thread id onto the record carrying it as `harness_session_id`. Claude needs neither step: its
  exported id equals its payload id equals the record key, so the direct hit always wins.
- **no rendezvous** (`ownsRendezvous:false`): codex has no reclaude control socket, so SpexCode uses Codex's
  own app-server. Each SpexCode project has ONE project-scoped `codex app-server --listen unix://<project sock>`
  (flock-guarded, started once, reused) under the same global project runtime dir as the hook manifest. Each
  worktree session = ONE thread on that server, created by the BACKEND: the launch script runs `spex
  codex-launch <sock> <worktree-cwd> <prompt>`, which `thread/start { cwd }`s (codex loads that worktree's
  per-cwd context — AGENTS.md, skills, project config — from the thread cwd; PROJECT HOOKS are the exception,
  read from the main checkout's `.codex` — VERIFIED both by codex-rs source and a live round-trip: with the
  shim at `<mainCheckout>/.codex/hooks.json` all five events fire for a worktree thread, and removing that file
  while the worktree's own `.codex/hooks.json` stays in place makes EVERY hook go silent — so a per-project
  server behaves like a per-worktree launch for everything except the hooks, which are genuinely per-project),
  stores the returned `thread.id` on the governed record (`harness_session_id`, keyed by
  `SPEXCODE_SESSION_ID`), then fires the prompt as the FIRST turn — materializing the thread's rollout on disk,
  which the visible `codex --remote unix://<sock> resume <tid>` TUI then renders natively (VERIFIED: the TUI
  resumes a backend-created thread once it has ≥1 turn, and a later `turn/steer`/`turn/start` also renders live
  in the pane). Follow-up delivery opens a WebSocket to the same socket's `/rpc` and `turn/steer`/`turn/start`s
  the OWNED thread id. The app-server is a shared control plane, not a session identity; session routing is
  solely the owned Codex thread id, so several `spexcode serve` processes never cross-send. Delivery falls back
  to reading the one loaded thread (`thread/loaded/list`) only for a pre-existing session whose id was never
  stored. Explicit `--remote` is the default because it deterministically binds the pane and backend control to
  the project app-server.
