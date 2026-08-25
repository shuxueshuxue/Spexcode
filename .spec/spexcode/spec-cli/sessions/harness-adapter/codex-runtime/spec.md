---
title: codex-runtime
status: active
hue: 280
desc: The Codex adapter's project-shared app-server runtime — where the daemon lives and what it may not inherit, the three trust tiers a dispatched thread needs, backend-owned thread identity and the rollout warm-up, JSON-RPC delivery and interrupt, descendant-tree liveness, and the shared-runtime ownership proofs behind stop, archive, and quarantine.
code:
  - spec-cli/src/harness.ts#codexHarness
related:
  - spec-cli/src/cli.ts
  - spec-cli/src/codex-runtime-generations.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/codex-headless.test.ts
  - spec-cli/src/harness.test.ts
---

# codex-runtime

The Codex adapter row of [[harness-adapter]] runs every worktree's thread on ONE project-scoped `codex app-server`.
That single fact is the root of everything below: the daemon must not inherit a worktree's cwd or any session's
identity, a dispatched thread must clear three independent trust tiers before a hook ever fires, the backend — not a
capture hook — owns each thread's id, liveness is read from the pane's process tree rather than a shared socket, and
every lifecycle mutation against the shared runtime must prove exactly which threads it owns before it moves
anything. [[codex-headless]] shares this runtime; [[shared-runtime-generation-rotation]] owns the generation ledger
that routes traffic to one canonical root.

**Hooks discovery and the layer anchor.** The shim's LOCATION is a divergence point too:
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
  not unimplemented. Failure detection therefore does not fabricate another hook: the Codex adapter's optional
  `observeTurnFailures` capability subscribes to the app-server's native `turn/completed` notifications and
  reports only structured `failed` outcomes to the shared session layer. Codex delivery must not read the native
  conversation history to choose between `turn/start` and `turn/steer`: that history is an unbounded transcript
  and can make a durable send wait past its confirmation budget. The adapter uses loaded/list only to prove the
  target is resident, then uses the observer's native `turn/started`/`turn/completed` notifications as the
  active-turn-id cache. A
  cached id is the only basis for `turn/steer`; otherwise delivery uses `turn/start` and reports a native
  rejection promptly, leaving the durable message pending rather than replaying history or hiding an unobserved
  active turn. The failure observer gives native `thread/resume` subscription up to 30 seconds because the
  measured app-server can take 15–17 seconds under load; a shorter timeout would turn a slow but valid response
  into a retry storm and resource leak. While subscribed it filters unrelated progress notifications at the
  WebSocket frame boundary, before UTF-8 decoding or JSON parsing; only the RPC handshake and native turn
  start/completion messages are part of this adapter contract.

**Trust — three tiers.** `--dangerously-bypass-hook-trust` covers only ONE of THREE independent codex tiers a dispatched worker must satisfy; the other two the adapter establishes explicitly (bypass alone leaves a fresh-init codex worker firing ZERO hooks, runtime.json frozen, no Session trailer):
  - **(a) layer BUILT** — the worktree needs a `.codex/` anchor (the events/shim point above); without it codex
    builds no project layer and the hooks are never even seen.
  - **(b) layer ENABLED** — codex-rs drops a DISABLED (untrusted) project layer BEFORE hook discovery runs
    (`get_layers(include_disabled=false)`), and `bypass_hook_trust` is read only AFTER, per-handler — so it can
    never ENABLE a layer. An untrusted project's WHOLE layer is disabled (`disabled_reason_for_decision`). The
    dispatched-worker app-server does NOT auto-trust (only the interactive TUI / `codex exec` approval flow
    does — the "auto-trust confound" that made a standalone `.codex` appear to work). So the adapter writes
    PROJECT trust (`[projects."<mainCheckout>"] trust_level = "trusted"`) UNCONDITIONALLY — the main-checkout key
    covers every worktree via codex's repo-root trust fallback. That write must be DUPLICATE-SAFE: codex refuses
    to load a config.toml with a duplicate key, and codex AUTO-writes a bare `[projects."<proj>"]` the moment it
    trusts a folder — so the writer STRIPS every prior definition of this project's trust (our sentinel block in
    any past format, a bare table, and its `[hooks.state]` entries) before appending, self-healing a config that
    already carries one instead of appending a second key that takes codex fully offline.
  - **(c) hooks REVIEWED** — even trusted+enabled, an unhashed hook is "new or changed", and codex FORCES the
    startup hook-review prompt on a PERSISTENT RESUME regardless of the bypass flag
    (`bypass_hook_trust_for_startup_review = config.bypass_hook_trust && !is_persistent_resume`, tui/src/lib.rs).
    Our visible TUI attaches via `codex … resume <tid>` (a persistent resume), so an unhashed hook WEDGES the
    worker at an interactive "Hooks need review" menu. So the adapter ALSO writes the reverse-engineered
    per-hook `trusted_hash` blocks (`codexHookHash`) UNCONDITIONALLY — matching hashes make `review_needed_count`
    == 0 and codex skips the prompt. (The old belief that a flag-capable binary could SKIP the hash was wrong:
    the flag does not suppress the resume review. The version-brittleness the bypass was meant to avoid is
    inherent — codex offers no config to disable the review — so we accept it and keep bypass only as DEFENCE.)

  A trust writer returns the path it asserted (or no paths for a harness whose trust mechanism writes
  nothing), making the materialization receipt and user-facing init report derive from the adapter's real
  side effect instead of a parallel capability claim. `bypass_hook_trust` still rides on BOTH thread paths as that defence (so the app-server thread runs the hooks
  even if a version bump makes a hash mismatch): (1) the BACKEND-owned `thread/start` (codex-launch) carries
  `config.bypass_hook_trust` — codex applies it **per thread** from the request's `config` override map, NOT from
  the shared app-server's own `--dangerously-bypass-hook-trust` CLI flag (INERT for a thread); (2) the visible
  `--remote … resume` TUI carries the flag. The capability probe (`<binary> --help`) MUST probe the SAME codex the
  session runs, so the launch script EXPORTS `SPEXCODE_CODEX_CMD` for the codex-launch child (a fallback bare
  `codex` picks the WRONG install on a multi-codex box and mis-decides). `SPEXCODE_CODEX_BYPASS_HOOK_TRUST` forces
  the switch. Claude relies on folder-trust (often nothing).

**Launch policy.** Because that backend-owned thread exists BEFORE the
  visible remote TUI, the adapter translates Codex's documented launcher autonomy flags (`--yolo` /
  `--dangerously-bypass-approvals-and-sandbox`, `-a` / `--ask-for-approval`, and `-s` / `--sandbox`) into the
  typed `thread/start` approval/sandbox fields; a flag present only on the later `--remote resume` command is
  not policy delivery. 

**Daemon placement and identity hygiene.** Codex's app-server is a per-PROJECT daemon shared across every
  worktree's threads, so it is started in the STABLE per-project runtime dir — never a caller's transient
  worktree: a daemon that inherited a worktree cwd is bricked when that worktree is later removed (its cwd goes
  `(deleted)` and codex then fails EVERY new thread's config load with `No such file or directory`). For the SAME
  reason it inherits no session IDENTITY: the spawn strips `SPEXCODE_SESSION_ID` and every adapter's
  `sessionEnvVar` (the list is adapter-derived, so a new harness needs no edit), because a project-scoped daemon
  started by whichever session launched first, serving every later thread, would otherwise hand that one
  session's id to every thread's tool shell — a stale lie for everyone else, and for nobody at all once that
  session closes and its record is swept (measured: daemons here still running for days under a long-gone
  session's id). The id a thread actually needs — its OWN — codex injects per command, so stripping the
  inherited ones removes a wrong answer without removing a right one. 

**Liveness and the delivery channel.** The tmux window is up AND a
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
  root checkout per the events/shim point above), proves its first durable turn, then stages the returned
  `thread.id` for the lifecycle owner to store as `harness_session_id` — no capture hook,
  no rollout-file scan, no cwd guess. The server may register that thread before the first user message materializes
  it. In that window `thread/turns/list` returns the exact protocol refusal `is not materialized yet;
  thread/turns/list is unavailable before first user message` (or, after native cleanup, `thread not loaded: <id>`);
  the lifecycle adapter treats only those exact responses as a
  proven no-turn interrupt result. During cold proof, the same response can prove an otherwise absent,
  descendant-free target is in the startup-only shape: an existing loaded reference is removed by the exact native
  delete request, while an already-unloaded target needs no mutation. Ordinary absent/unowned targets, timeouts,
  and all other transport, ownership, or turn-state errors remain refusal paths. The
  app-server `--listen unix://<sock>` endpoint is a WebSocket at path `/rpc` (the same upgrade the `--remote`
  TUI performs); delivery speaks WebSocket JSON-RPC over that Unix socket directly — NOT `codex app-server
  proxy` (a dumb byte relay that performs no HTTP upgrade, which the server rejects).
  

**Delivery, interrupt, and the failure observer.** The adapter reaches its same-turn poke through the
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
turn. Its hard interrupt follows the same exact-native rule: read the newest `inProgress` turn through the
owned generation, send `turn/interrupt {threadId, turnId}`, then re-read until it has settled; an idle thread is
already interrupted, while a generation change, unreadable turn, or still-active turn refuses loudly. The adapter uses one independent `thread/resume` connection to atomically subscribe to that owned
  thread's outcome notifications. A live `turn/completed` with status `failed` carries the native error message
  and `completedAt`; `completed` and `interrupted` are controls and produce no lifecycle write. When a backend
  replacement joins a thread already in `systemError`, the same resume response's `initialTurnsPage` supplies
  the latest turn id and completion time. A concurrent native `turn/started` cancels that historical projection,
  so an old failure cannot overwrite the new turn's active lifecycle.
  

**Resume.** `resumeArg(rec, pendingLaunchPayload)` is the relaunch tail `reopen()` hands `launch()`, but the two harnesses consume that
  tail differently and the codex side MUST honour that: **claude** `--resume <id>` is appended straight to the
  `claude` command (the SAME conversation, the id we pinned). **codex** has no bare `codex` to append to — its
  `launchCmd` is a bootstrap script that feeds the tail (`"$@"`) to `spex internal codex-launch`, which mints a NEW
  thread and fires the tail AS the first-turn prompt. So the codex resume tail is a `--resume <thread-id>`
  **marker** the script branches on: it resumes the owned thread DIRECTLY (skip `codex-launch`, no new thread,
  no prompt turn — `tid=<thread-id>`), then its final `codex … resume "$tid"` performs codex's own resume on the
  owned id — its rollout persists on disk, the SAME conversation. With no captured id, Codex requires the
  authoritative pending resolved launch payload and returns those exact bytes as the new thread's first prompt;
  absence is a loud adapter refusal, never an empty fresh thread and never reconstruction from the raw
  originating prompt. The discriminator is sound because a new launch's tail is always ONE
  single-quoted prompt arg, never the literal `--resume` — so a resume can never be mistaken for a prompt and
  fed to `codex-launch` (which would mint a NEW thread whose first message is the marker text).
  

**Shared-runtime ownership proofs.** A shared runtime also declares its
  PID/isolation artifacts and a live control-plane probe through the adapter. The probe reports the runtime's loaded-thread
  set and whether each reference is active; active is a state of one loaded reference, not another reference.
  Record-only and queued sessions cannot invent a reference, while a loaded thread with no matching record stays
  in the set as unowned. Ownership joins only governed records belonging to adapters that declare that same
  shared-runtime descriptor; a coincidentally equal id from another adapter or a non-governed record is not a
  reference owner. An unhealthy/unknown probe returns an unknown refcount rather than a record-derived fallback;
  product mutation treats that uncertainty as a separate fail-closed blocker. The adapter exposes full projection
  and mutation proof as separate capabilities: resource reporting may read every loaded reference to describe turn
  presence, while lifecycle mutation uses the paginated loaded-ID set, both exact target descendant collections, and
  the whole-collection census — whose rows already carry each thread's live turn state, so presence for every member
  is answered by the reads the proof performs anyway. A gate asks whether a turn is in flight at the tip, so its cost
  must track how many threads exist, never how much history any one of them holds; a per-thread transcript read makes
  a long-lived session unmutatable against any fixed budget, and raising the budget only moves the threshold. Turn
  IDENTITY is the separate question: only interrupt needs to name the turn it interrupts, so only interrupt pays a
  transcript read, against a target that is by definition active. Presence the app-server did not report — including
  two native sources contradicting each other — never becomes an `active` verdict. For Codex cold teardown alone, an
  otherwise uniquely-owned member with that unknown presence may consult the final record in its durable rollout tail:
  a terminal native event proves its turn settled, while a missing, unreadable, incomplete, or non-terminal tail stays
  fail-closed and names both the live Codex client and rollout evidence in the refusal. A live `active` report remains
  the unchanged immediate refusal; the durable tail cannot override it. The periodic report keeps its short bounded
  probe budget; a lifecycle mutation's explicit target census has its own longer bounded budget so a busy shared
  app-server does not turn a safe target proof into a false refusal. A transport-local census refusal is retried
  a small bounded number of times with the same generation fence; semantic ownership refusals return immediately.
  Ordinary stop reads the target and refuses
  descendants. Cold archive treats the adapter's native `ancestorThreadId` result as an ownership closure (all depths,
  excluding the ancestor), verifies every member's direct-parent chain against the active/archived collections,
  establishes every loaded member's turn presence from those same collections, and archives the initially-active
  closure deepest-first with the ancestor last;
  already-archived members are proof, not mutation.
  Unreadable-record quarantine is a separate, narrower adapter operation because it has no record-shaped ownership
  claim to pass into cold archive. It receives one exact native thread id plus the exact unreadable record id
  excluded from the owner census; that exclusion leaves the incident record opaque without blindfolding the census,
  so any other unreadable governed record remains an unknown-control refusal. Before archiving, the adapter proves
  the one materialized target occurrence across every non-reclaimed generation; no occurrence, a duplicate occurrence,
  or an unproven generation refuses rather than falling back to current or legacy. It then proves that exact stable
  generation, zero other governed owners, an exact one-thread closure, no descendants, and an idle known turn. It may
  accept an already-archived target only after proving that exact target is unloaded. Otherwise it
  archives only that target, then re-censuses the same generation and target while preserving every loaded sibling
  reference. It returns public audit facts and an in-memory compensation closure; if the outer opaque-byte move
  does not commit, compensation can restore only the thread it just archived and only on the original generation.
  Live, active, owned, ambiguous, descendant-bearing, changed-generation, or unknown native state always refuses
  before the record layer moves bytes.
  The mutation proof fences the shared PID/start/detached-receipt/
  socket generation across those reads; an unrelated slow sibling remains a protective loaded ID but cannot block
  an isolated target subtree. Post-mutation it re-censuses the identical closure, requires the whole subtree unloaded
  and uniquely archived, and keeps unrelated loaded siblings intact. Duplicate active/archived membership, a member
  absent from both collections, changed ancestry, or a late replacement fails closed; compensation restores only
  originally-active members and only on the unchanged generation. That generation exists only for one verifier-owned
  version-4 detached launch receipt whose live PID/start and process group agree, whose Linux `/proc` session also
  agrees when running on Linux, and whose socket inode is unchanged. Darwin never consumes `ps sess` as evidence.
  During the one-way v3 receipt migration, a **mutation guard only** may atomically promote the retired
  `detached-v3 PID start PGID SID` scope to that v4 receipt, and only when every stored field equals the exact
  live Linux identity; reporting and all other reads never mint or repair a receipt. Missing, malformed, or
  mismatched legacy evidence remains an unproven generation and refuses the mutation before any session teardown.
  Unknown/active subtree state, ambiguous ancestry, or a generation change fails closed, and compensating mutation
  is permitted only on the unchanged original generation.
  The adapter receipt also owns post-cold compensation outside the native RPC boundary: until the product commits
  the archive record and final offline proof, a failure returns the same receipt to `restoreRuntime`, which restores
  all and only its originally-active subtree members. A receipt-free resume remains the normal parent-only restore.
  The Codex app-server is spawned
  as a detached child in its own operating-system process group and session, not merely wrapped in `nohup`
  (`nohup` did not survive the real Codex Node launcher resetting signal behavior). The process adapter writes a
  private receipt only after proving PID/start and `PGID == PID`, plus Linux `SID == PID`; every later consumer
  re-verifies it through that adapter, while Darwin deliberately asks no `ps sess` question. A receipt alone never
  proves the live boundary.
  Killing the pane that happened to launch the daemon therefore cannot HUP unrelated turns.
  

**Headless readiness.** Codex-headless readiness freezes one exact live detached shared-root receipt/socket
  generation, the loaded target thread, and its unique governed record owner.
  Ownership is joined from every governed record whose adapter declares that shared-runtime descriptor; exactly
  one record may claim the target thread and it must be the session being resumed. The loaded-ID set establishes
  reference state but cannot establish record ownership. The post-pending validator repeats the full generation,
  loaded-reference, and owner join: an unload, restart, owner collision, or reassignment retains/restores the
  original stopped/offline projection without a false transition. This launch fence does not replace Codex's
  steady-state shared-record liveness: once committed, its sleeping thread remains addressable through the app-server.

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
  and accepts both `apply_patch` and `Bash` as code-touch tools; otherwise [[inject-spec-of-file]] and an edit-first
  [[inject-spec-first]] are INERT on codex (the first cut had both bugs — proven live, then fixed). The store/dispatch
  layer itself is sound (mark-active flip, declare/commit gate, silent non-governed Stop all work once hooks
  fire) — but that was first "proven" on a STANDALONE `.codex` in the cwd, which the interactive/`exec` flow
  AUTO-TRUSTS, masking the dispatched-worker gap: a linked-worktree thread on the shared app-server needs the
  layer BUILT + ENABLED + hooks HASHED (the trust point above) before dispatch.sh ever runs. Verified on a real
  FRESH-INIT dispatched codex worker: with the anchor + project trust + per-hook hashes in place, SessionStart…
  Stop fire through dispatch.sh, runtime.json advances past launch, and the commit carries the Session trailer.
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
  handoff. The remote TUI also receives `--cd <worktree-cwd>` explicitly: with `tui.resume_cwd = "current"`,
  Codex refuses a remote workspace that has no `--cd`, so the generated command must quote the pane's `$PWD`
  as one argument (including worktree paths containing spaces).
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
  runtime dir) and `<socketBase>` is an **owned per-uid subdirectory of the platform tmpdir**
  (`spexcode-cx-<uid>`, created 0700 by the derivation itself; the `SPEXCODE_CODEX_SOCKET_DIR` env override
  still replaces it) — NEVER bare tmpdir, and NOT
  nested under the project runtime dir. Bare `/tmp` is not merely untidy, it is BROKEN out of the box: on a
  normally-hardened Linux host (`fs.protected_regular=2`, root-owned sticky `/tmp` — stock Ubuntu) codex
  refuses to bind a unix socket directly in the shared sticky `/tmp` (EPERM), so the server never comes up,
  the client connect ENOENTs, and every codex-launcher session dies through launch.sh's retries while claude
  launchers work — yet the same codex binds fine in any owned subdirectory (github#30). Per-uid, not one
  shared dir, so a second user on the box never lands in the first user's 0700 dir; the launch script
  re-`mkdir -p -m 700`s the base at run time in case a tmp cleaner wiped it after the bake.
  The path MUST also stay short because a Unix socket path is capped at `sun_path`
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
  fires the prompt as the FIRST turn — materializing the thread's rollout on disk — then stages the returned
  `thread.id` plus payload proof for the governed record (`harness_session_id`, keyed by `SPEXCODE_SESSION_ID`),
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
  then WAITS (`waitForCodexRollout`, 20s) for the rollout to land BEFORE it stages `harness_session_id` proof or prints
  the id — so the id it returns is always resume-ready, and a genuine miss FAILS LOUD (non-zero, stages nothing;
  launch.sh aborts rather than `resume ""`). The 20s budget deliberately exceeds launch.sh's fast-fail threshold,
  so a real failure exits PAST it and the retry loop treats it as a true end, never a duplicate-prompt respray —
  turning a silent permanent wedge into an honest, non-duplicating retry. The rollout scan walks day-dirs
  newest-first but EXHAUSTIVELY — never capped at "the newest few" — because future-dated junk under
  `sessions/` (a test once planted `2099/12/*` in the real CODEX_HOME) sorts above every real day-dir, and a
  cap let three such dirs mask ALL real rollouts: every launch then died "persisted no rollout" with the
  rollout sitting on disk. No cold-branch pre-warm is needed: the
  wait absorbs the warm-up on the first launch after a server boot (a few extra seconds in `starting`). Follow-up delivery opens a WebSocket to the same socket's `/rpc` and `turn/steer`/`turn/start`s
  the OWNED thread id. The app-server is a shared control plane, not a session identity; session routing is
  solely the owned Codex thread id, so several `spexcode serve` processes never cross-send. Delivery falls back
  to reading the one loaded thread (`thread/loaded/list`) only for a pre-existing session whose id was never
  stored. Explicit `--remote` is the default because it deterministically binds the pane and backend control to
  the project app-server.
