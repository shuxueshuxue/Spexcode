---
title: harness-adapter
status: active
hue: 280
desc: One seam between SpexCode and the coding-agent harness (Claude Code, Codex, …). Every harness-specific fact lives behind a single Adapter interface with one impl per harness; product code never branches on which harness it is.
code:
  - spec-cli/src/harness.ts
  - spec-cli/src/harness.test.ts
  - spec-cli/hooks/harness.sh
  - spec-cli/templates/hooks/prepare-commit-msg
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
its harness from the shim that wired it — deterministically, never by guessing the payload shape. There is a
third baked id beyond the native two: `plugin`, written by the [[plugin-harness]] bundle's `hooks.json`. It has
no `Harness` adapter of its own (it is a DELIVERY form, not a runtime) — `dispatch.sh` accepts it and `harness.sh`
routes it through the **claude family** (a plugin host like z-code/Claude shares Claude's payload shape) via the
default case, so the shell side needs no separate `plugin)` arm. On the TS
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
  from the thread cwd, so the one shared shim still gates each worktree correctly. But that rewrite has a
  LAYER-ANCHOR precondition: codex-rs builds a project config layer only for a dir (in cwd→project-root) that
  itself contains a `.codex/` directory, THEN rewrites that layer's hooks-folder to the root checkout. A linked
  worktree whose root has NO `.codex/` anchors NO layer, so the rewritten root hooks are never discovered and
  ZERO hooks fire — silently (this bit a FRESH-INIT project with no skill nodes: the dogfood only worked by
  accident, its materialized `.codex/skills` incidentally supplying the anchor). So the Codex adapter ALSO writes
  its shim into the worktree's own `.codex/hooks.json` — a pure ANCHOR (the rewrite ignores its content, reading
  the root's; `worktreeHookAnchor`), null for claude (its shim already lives in the worktree) and for the main
  checkout (`shimFile` wrote it there). Codex lacks Notification + StopFailure: codex's
  canonical hook event set (its `HookEventName` enum, codex 0.142.3) is preToolUse/permissionRequest/postToolUse/
  preCompact/postCompact/sessionStart/userPromptSubmit/subagentStart/subagentStop/stop — there is no idle/
  attention "notification" event and no failed-stop event, so those two claude-only events are genuinely absent,
  not unimplemented.
- **contract file(s)** — where the `surface: system` block is materialized ([[harness-delivery]]): Claude
  `./CLAUDE.md` or `./.claude/CLAUDE.md`; Codex ONLY the repo-root `./AGENTS.md`.
- **render dirs** — the auto-discovered dirs the on-demand surfaces materialize into, or null when the harness
  lacks that primitive: `skillDir` for `surface: skill` (`SKILL.md`s — claude `.claude/skills/`, codex
  `.codex/skills/`) and `agentDir` for `surface: agent` (sub-agent `<name>.md`s — claude `.claude/agents/`;
  Codex has no file-discovered agent-definition primitive → null, so materialize skips it). Each is ONE
  adapter line; a null dir is the whole "this harness can't" branch, never an `if (codex)` in materialize.
- **trust** — make an agent run our hooks with zero prompts. This is codex's HARDEST divergence, because
  `--dangerously-bypass-hook-trust` covers only ONE of THREE independent codex tiers a dispatched worker must
  satisfy — the other two the adapter establishes explicitly (bypass alone leaves a fresh-init codex worker
  firing ZERO hooks, session.json frozen, no Session trailer):
  - **(a) layer BUILT** — the worktree needs a `.codex/` anchor (the events/shim point above); without it codex
    builds no project layer and the hooks are never even seen.
  - **(b) layer ENABLED** — codex-rs drops a DISABLED (untrusted) project layer BEFORE hook discovery runs
    (`get_layers(include_disabled=false)`), and `bypass_hook_trust` is read only AFTER, per-handler — so it can
    never ENABLE a layer. An untrusted project's WHOLE layer is disabled (`disabled_reason_for_decision`). The
    dispatched-worker app-server does NOT auto-trust (only the interactive TUI / `codex exec` approval flow
    does — the "auto-trust confound" that made a standalone `.codex` appear to work). So the adapter writes
    PROJECT trust (`[projects."<mainCheckout>"] trust_level = "trusted"`) UNCONDITIONALLY — the main-checkout key
    covers every worktree via codex's repo-root trust fallback.
  - **(c) hooks REVIEWED** — even trusted+enabled, an unhashed hook is "new or changed", and codex FORCES the
    startup hook-review prompt on a PERSISTENT RESUME regardless of the bypass flag
    (`bypass_hook_trust_for_startup_review = config.bypass_hook_trust && !is_persistent_resume`, tui/src/lib.rs).
    Our visible TUI attaches via `codex … resume <tid>` (a persistent resume), so an unhashed hook WEDGES the
    worker at an interactive "Hooks need review" menu. So the adapter ALSO writes the reverse-engineered
    per-hook `trusted_hash` blocks (`codexHookHash`) UNCONDITIONALLY — matching hashes make `review_needed_count`
    == 0 and codex skips the prompt. (The old belief that a flag-capable binary could SKIP the hash was wrong:
    the flag does not suppress the resume review. The version-brittleness the bypass was meant to avoid is
    inherent — codex offers no config to disable the review — so we accept it and keep bypass only as DEFENCE.)

  `bypass_hook_trust` still rides on BOTH thread paths as that defence (so the app-server thread runs the hooks
  even if a version bump makes a hash mismatch): (1) the BACKEND-owned `thread/start` (codex-launch) carries
  `config.bypass_hook_trust` — codex applies it **per thread** from the request's `config` override map, NOT from
  the shared app-server's own `--dangerously-bypass-hook-trust` CLI flag (INERT for a thread); (2) the visible
  `--remote … resume` TUI carries the flag. The capability probe (`<binary> --help`) MUST probe the SAME codex the
  session runs, so the launch script EXPORTS `SPEXCODE_CODEX_CMD` for the codex-launch child (a fallback bare
  `codex` picks the WRONG install on a multi-codex box and mis-decides). `SPEXCODE_CODEX_BYPASS_HOOK_TRUST` forces
  the switch. Claude relies on folder-trust (often nothing).
- **clean / removeTrust** — the materialize INVERSE: `clean(proj, arts)` surgically removes ONLY this harness's
  own artifacts — the managed contract block (sentinels), the generated shim, the trust block (`removeTrust`,
  the inverse of trust above), and the `arts`-named skill/agent files. Every step is gated on a SpexCode
  identity stamp (the managed-block sentinels, the shim's own `dispatch.sh` command line, the trust sentinels,
  the name-scoped on-demand paths), so it never touches a user's CLAUDE.md/AGENTS.md prose, a hand-made
  settings.json, a sibling skill the user added, or any `.spec` data. [[harness-delivery]] calls it for every
  harness [[harness-select]] did NOT select, so dropping a harness from `harnesses` prunes its products. Adding
  a harness adds an adapter (with its `clean`), never a prune branch in materialize.
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
  `ownsRendezvous` instead of hard-wiring the claude rendezvous socket. `liveness(rec, tmuxAlive, runtimeDir, pane)`
  answers "is this session's agent ready?" — from the caller's ONE runtime snapshot, which carries the window
  presence AND a per-pane probe (the pane's root pid + one whole-box process table from a single `ps`).
  **claude** = the tmux window is up AND its reclaude
  rendezvous socket exists (the socket is the truth claude is alive — the pane command is always the wrapper/shell
  while claude runs as its child, so claude IGNORES the pane probe); **codex** = the tmux window is up AND a
  **codex process is live in the pane's DESCENDANT process tree**. The pane's FOREGROUND name is NOT the signal:
  a healthy, rendering codex TUI's `pane_current_command` is **`bash`** (the launch wrapper) for its whole life —
  the codex processes live BELOW the pane pid (`bash launch.sh` → `bash -lc` → `node` (the codex CLI) → the
  vendored `codex` binary) — so the earlier foreground==codex probe FALSE-read every live codex as offline
  (field-confirmed), the strictly worse direction: the board showed working codex sessions as dead and a
  supervisor could wrongly reopen/kill them. Nor is the app-server socket the signal: it is **per-PROJECT and
  SHARED** by every worktree's thread, so it stays bound even when THIS session's visible
  `codex --remote … resume <tid>` TUI FAILED and its launch pane, after the bounded resume retries, dropped back
  to the shell prompt — sock-presence read a dead launch as online (the first field-confirmed false-positive).
  The honest per-session discriminator is the pane's process TREE: HEALTHY = a codex-ish process (matched by
  basename `codex*` or `node*` — the CLI runs as node before/alongside the vendored binary) exists among the
  pane pid's descendants; FAILED = the retries exhausted, everything under the pane exited, the pane sits at a
  bare idle shell with no codex/node anywhere below it. A probe tmux/ps couldn't report is not-live. The
  'starting' boot grace stays in the
  CALLER (sessions.ts liveness), so a still-booting codex pane — whose tree may not yet contain codex while
  bash bootstraps the shared app-server — reads 'starting', not 'offline', for the legitimate startup window.
  The app-server socket
  is still the DELIVERY channel (per project, keyed on `runtimeRoot()`, ONE app-server shared by every worktree's
  thread), just not the liveness gate. The session's thread id is NOT discovered at all — the BACKEND OWNS it: at launch it
  `thread/start { cwd: <this worktree> }`s on the shared server (codex resolves that worktree's per-cwd
  context — `AGENTS.md` + skills + project config — by walking the thread cwd, so one project-scoped server
  behaves analogously to a per-worktree claude launch; its PROJECT HOOKS are the one exception, read from the
  root checkout per the events/shim point above) and stores the returned `thread.id` on the governed record as `harness_session_id` — no capture hook,
  no rollout-file scan, no cwd guess. The
  app-server `--listen unix://<sock>` endpoint is a WebSocket at path `/rpc` (the same upgrade the `--remote`
  TUI performs); delivery speaks WebSocket JSON-RPC over that Unix socket directly — NOT `codex app-server
  proxy` (a dumb byte relay that performs no HTTP upgrade, which the server rejects).
  `deliver(rec, text)` sends a
  follow-up prompt and reports whether it landed, but the two harnesses confirm delivery at DIFFERENT layers.
  **claude** is **OPTIMISTIC-after-liveness**: the socket's presence IS the liveness gate (deliver fails loud
  before writing when the rendezvous socket is absent — a missing/dead socket, never tmux, is the not-alive
  signal), then it connects and WRITES the `{type:reply}` line; once that line flushes to the live socket with no
  immediate transport error (a connect throw, a socket `error` like ECONNREFUSED/EPIPE, or a `close` before the
  write flushes — all FREE, INSTANT, and reported), the reply is on the wire and claude submits it the moment it
  yields, so deliver returns ok THERE. It does **not** wait for an application-level acceptance ack. This is a
  deliberate reversal of the earlier design, which wrote a `{type:repaint}` probe after the reply and waited up to
  a 2500ms wall for a `{type:repaint-done}` to prove the reply was processed: that ordering barrier is sound
  ONE-WAY (`repaint-done` ⟹ delivered) but its ABSENCE within the wall does NOT mean not-delivered — a mid-turn
  **BUSY** claude cannot answer the probe promptly, so a message that actually landed reported a COMMON, misleading
  FALSE FAILURE (`rendezvous socket gave no acceptance confirmation within 2500ms`). The confirmation therefore
  moves to the **transport/liveness** layer, not the application layer. The knowingly-accepted cost: we no longer
  detect the narrow **alive-but-wedged / reply-rejected / shutting-down** cases — a rare SILENT drop, recoverable
  because the supervisor sees the worker never transition — in exchange for killing the frequent false-failure on a
  live-but-busy worker. **codex** confirms at the application layer through the same
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
  turn. `resumeArg(rec)` is the relaunch tail `reopen()` hands `launch()`, but the two harnesses consume that
  tail differently and the codex side MUST honour that: **claude** `--resume <id>` is appended straight to the
  `claude` command (the SAME conversation, the id we pinned). **codex** has no bare `codex` to append to — its
  `launchCmd` is a bootstrap script that feeds the tail (`"$@"`) to `spex codex-launch`, which mints a NEW
  thread and fires the tail AS the first-turn prompt. So the codex resume tail is a `--resume <thread-id>`
  **marker** the script branches on: it resumes the owned thread DIRECTLY (skip `codex-launch`, no new thread,
  no prompt turn — `tid=<thread-id>`), then its final `codex … resume "$tid"` performs codex's own resume on the
  owned id — its rollout persists on disk, the SAME conversation. Empty marker (no captured id) → a fresh thread
  on the same worktree/record. The discriminator is sound because a new launch's tail is always ONE
  single-quoted prompt arg, never the literal `--resume` — so a resume can never be mistaken for a prompt and
  fed to `codex-launch` (which would mint a NEW thread whose first message is the marker text).
  sessions.ts's `liveness()`/`isOccupying()`/`sendKeys()`/
  `reopen()`/`waitForReady()` all route through these adapter methods — there is no socket hard-wire and no
  `if (codex)` left in the runtime path; the rendezvous-socket path + its `replyViaSocket` optimistic write MOVED into
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
from the SHARED per-project app-server process, whose env can inherit the FIRST session's baked
`SPEXCODE_SESSION_ID`, so a governed codex hook must NOT trust that env var. On codex, `hp_session_id` resolves
from the hook payload's `session_id` — the acting codex THREAD id — and id→record resolution carries an ALIAS
step: when no record sits at the id directly, find the one record that captured this id as `harness_session_id`
(a `grep` over the few session.json files on the shell hot path — no jq; the typed TS read mirrors it in
`readAliasedRawRecord`). This is what lets the pure-shell `mark-active` re-flip and the ask-capture, plus every
shell hook lifecycle write, reach the right record from a thread id even when the app-server env is contaminated.
The alias needs no cleanup artifact — it lives in the record's own `harness_session_id`, swept with the record on
close. The agent's own interactive `spex session done/park/ask` calls take the SAME path for the SAME reason:
codex runs them in the shared app-server shell (NOT a per-session pane), so they inherit the FIRST session's
baked `SPEXCODE_SESSION_ID` — `envSessionId` ([[portable-layout]]) therefore resolves codex's per-command
`CODEX_THREAD_ID` (the acting thread's `sessionEnvVar`) through the same `harness_session_id` alias BEFORE that
contaminated `SPEXCODE_SESSION_ID`, so each thread's declaration lands on its own record; the hook path and the
interactive-CLI path share one precedence rule. The **commit-attribution** hook (`prepare-commit-msg`, the
`Session:` trailer) is a THIRD consumer of this same rule: a codex worker's `git commit` runs in the shared
app-server shell (contaminated `SPEXCODE_SESSION_ID`) but carries the acting `CODEX_THREAD_ID`, so the hook
resolves the RECORD id through the SAME `harness_session_id` alias grep AT COMMIT TIME (the record is swept on
close, so read-time aliasing would fail) — never the raw thread id, never the contaminated env var. Claude is
unaffected on all paths: its exported `CLAUDE_CODE_SESSION_ID` equals both its payload id and the record key, so
the direct hit always wins and the alias step never runs.

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
  layer itself is sound (mark-active flip, declare/commit gate, silent non-governed Stop all work once hooks
  fire) — but that was first "proven" on a STANDALONE `.codex` in the cwd, which the interactive/`exec` flow
  AUTO-TRUSTS, masking the dispatched-worker gap: a linked-worktree thread on the shared app-server needs the
  layer BUILT + ENABLED + hooks HASHED (the trust point above) before dispatch.sh ever runs. Verified on a real
  FRESH-INIT dispatched codex worker: with the anchor + project trust + per-hook hashes in place, SessionStart…
  Stop fire through dispatch.sh, session.json advances past launch, and the commit carries the Session trailer.
- **session-id model** (codex-rs source-verified): codex MINTS its own thread id internally (`Uuid::new_v4`/
  `ThreadId::new`) — there is NO flag/env to pin a NEW session's id (`CODEX_THREAD_ID` is an OUTPUT codex
  injects, not an input; resume takes an existing rollout id). So a dashboard-launched codex session can't have
  its governed record keyed by the harness id the way claude's `--session-id` allows. The adapter's resolution:
  the launcher keys the record by a SpexCode id, stores the codex thread id on it as `harness_session_id`, and a
  codex hook resolves from the payload THREAD id first because the shared app-server env may carry another
  session's `SPEXCODE_SESSION_ID`. id→record resolution then ALIASES that thread id onto the record carrying it as
  `harness_session_id`. Claude needs neither step: its exported id equals its payload id equals the record key, so
  the direct hit always wins.
- **no rendezvous** (`ownsRendezvous:false`): codex has no reclaude control socket, so SpexCode uses Codex's
  own app-server. Each SpexCode project has ONE project-scoped `codex app-server --listen unix://<project sock>`
  (started once, reused). The app-server and the visible `codex --remote unix://<sock> resume <tid>` TUI **share
  that one socket, so they MUST be the SAME codex install** — a version split across the socket breaks the
  `thread/start`→resume handoff (the app-server on one version creates a thread a differently-versioned resume
  can't find, and an old-enough app-server can't serve `--remote unix://` at all). So the app-server command is
  **DERIVED from the in-effect launcher `codexCmd`'s binary** (its first shell token, dropping args like
  `--yolo`): `<bin> app-server` runs the exact install `<bin> --remote … resume` will. It is NOT a bare `codex`
  off PATH — on a multi-install host (e.g. a homebrew codex shadowing an nvm codex) a bare `codex` resolves to a
  DIFFERENT binary than the launcher's, which was the macOS-only version-skew failure. `SPEXCODE_CODEX_SERVER_CMD`
  stays the explicit escape hatch (highest precedence, overriding the derivation); a `codexCmd` whose first token
  is a wrapper script forwards `app-server` through the wrapper. That socket lives on a **short, `sun_path`-safe,
  per-project-unique path** —
  `<socketBase>/spexcode-cx-<hash>.sock`, where `<hash>` is a stable digest of the project identity (the
  runtime dir) and `<socketBase>` is the platform tmpdir (or the `SPEXCODE_CODEX_SOCKET_DIR` override) — NOT
  nested under the project runtime dir. It MUST be short because a Unix socket path is capped at `sun_path`
  (~104 bytes on macOS, 108 on Linux) and `runtimeRoot()` flattens the entire project path into one long
  dash-segment (`encodeProject`), so the naive `<runtimeRoot>/codex-app-server.sock` overran the cap on a deep
  macOS project (`path must be shorter than SUN_LEN` + connect EINVAL — the app-server never bound; Linux's
  larger limit + shorter `/root` paths happened to fit). The hash is derived from the SAME project identity the
  launch, liveness, and delivery seams all pass, so they compute the IDENTICAL sock with no coordination — the
  one-app-server-per-project invariant. The short-path derivation is unconditional on every platform (no darwin
  branch — a platform difference handled at the path seam, not a product `if`). The `.pid`/`.log`/`.lock`
  sidecar files carry no `sun_path` limit and stay under the project runtime dir. The check-and-start of
  that shared server is serialized by a **POSIX-portable lock** — an atomic `mkdir` mutex with a bounded wait,
  NOT util-linux `flock` (absent on macOS, where the flock path failed the whole bootstrap and left the pane at
  the shell). The lock is held only across the check-and-start and released immediately; a stale dir left by a
  dead launcher is cleared after a bounded wait so it can never deadlock a launch. Because a mkdir lock has no
  inherited-fd hazard (unlike flock, held until every fd on its open file description closes), the long-lived
  daemon can't pin it — no fd-inheritance guard on the spawn. Each
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
  in the pane). That resume reads the thread's ROLLOUT FILE
  (`<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<ts>-<tid>.jsonl`), so a resumable thread is exactly one whose
  rollout exists — and that file has a **WARM-UP RACE** the launch must wait out (VERIFIED live, codex 0.142.5):
  `thread/start` ALONE writes no rollout (only a fired turn does), and a **freshly-spawned** app-server acks
  thread/start+turn but persists the rollout ~2-4s LATE — the SAME thread's file lands a few seconds after, it is
  not lost. A launch that hands the id to `resume` immediately dies with "no rollout found for thread id", and the
  launch retry loop then misreads that fast failure as a daemon race, sprays fresh threads, and stores the last
  (non-resumable) id — wedging every future reopen. The guard is ONE waypoint: `codex-launch` fires the first turn
  then WAITS (`waitForCodexRollout`, 20s) for the rollout to land BEFORE it stores `harness_session_id` or prints
  the id — so the id it returns is always resume-ready, and a genuine miss FAILS LOUD (non-zero, stores nothing;
  launch.sh aborts rather than `resume ""`). The 20s budget deliberately exceeds launch.sh's fast-fail threshold,
  so a real failure exits PAST it and the retry loop treats it as a true end, never a duplicate-prompt respray —
  turning a silent permanent wedge into an honest, non-duplicating retry. No cold-branch pre-warm is needed: the
  wait absorbs the warm-up on the first launch after a server boot (a few extra seconds in `starting`). Follow-up delivery opens a WebSocket to the same socket's `/rpc` and `turn/steer`/`turn/start`s
  the OWNED thread id. The app-server is a shared control plane, not a session identity; session routing is
  solely the owned Codex thread id, so several `spexcode serve` processes never cross-send. Delivery falls back
  to reading the one loaded thread (`thread/loaded/list`) only for a pre-existing session whose id was never
  stored. Explicit `--remote` is the default because it deterministically binds the pane and backend control to
  the project app-server.
