---
scenarios:
  - name: nested-subagent-hooks-do-not-clobber-parent-record
    tags: [backend-api]
    code: spec-cli/hooks/harness.sh
    description: >-
      A governed claude session (record P, declared `parked`) spawns nested subagents (Task tool), which
      inherit SPEXCODE_SESSION_ID=P in their environment but carry their OWN session_id in every hook
      payload. Simulate the child's hook exactly: a PreToolUse payload with session_id=S-child piped to
      dispatch.sh with SPEXCODE_SESSION_ID=P exported. Also simulate the two legit env uses: the parent's
      own payload (session_id=P) and a payload with NO session_id at all. Read record P after each.
    expected: >-
      The child's hook resolves to ITS payload id (S-child, non-governed, no record → the board-lifecycle
      hooks no-op) and record P stays `parked` with its note intact — a parent's declared state survives
      its own subagents' activity (the measured failure: every park was clobbered back to `active` within
      seconds by inherited-env mark-active, so the session read `working` on the board forever). The
      parent's own payload still writes P, and a payload-less event still falls back to the env id — the
      payload wins only when present, mirroring the codex alias rule one case below.
  - name: codex-apply-patch-triggers-spec-hooks
    tags: [backend-api]
    description: >-
      Through a REAL codex session (live exec/TUI, not a synthetic payload), make the agent (a) READ a code file
      via a shell command and (b) EDIT a code file via apply_patch. Codex sends the edit as its OWN tool
      `tool_name:"apply_patch"` whose `tool_input.command` is the bare patch envelope (`*** Update File: <path>`)
      — no `file_path`, no literal `apply_patch` token. Observe the global session dir's spec-first sentinel and
      spec-of-file ledger.
    expected: >-
      The adapter's shell mirror (`hp_code_path` accepting `apply_patch|Bash`, mutation keyed off the `*** … File:`
      markers) maps BOTH the Bash read and the apply_patch edit to the touched path: spec-first fires on the first
      code access (read OR an edit-first session), and spec-of-file records the EDITED path in its ledger —
      identical user-observable behaviour to a Claude user's Read/Edit. The failure this locks: when the edit
      tool/envelope is not mapped, spec-of-file and edit-first spec-first go SILENTLY INERT on codex while Bash
      reads still work, so a synthetic Bash-only test passes green and the regression hides — it must be measured
      through the real apply_patch round-trip. SECOND, ATTRIBUTION: because design C's hooks fire from the SHARED
      app-server (whose env may carry another session's `SPEXCODE_SESSION_ID`), `hp_session_id` must start from
      the codex payload THREAD id, so the sentinel/ledger AND mark-active's re-flip reach the SpexCode-id
      GOVERNED record resolved via the thread-id→`harness_session_id` alias (`hp_store_dir`), NOT the stale env
      session and NOT a phantom `<runtime>/sessions/<thread-id>` dir.
      The failure this locks: without the alias the writes silently target a non-existent dir and the board never
      sees the codex session flip to `active` / `asking`. The agent's explicit `spex session done/park/ask` calls
      run in the SAME shared app-server process (NOT a per-session TUI pane), so they too inherit the baked FIRST
      session's `SPEXCODE_SESSION_ID` and — before the fix — cross-contaminated, every codex session's declaration
      landing on the first; they attribute per-thread ONLY because `envSessionId` resolves codex's injected
      `CODEX_THREAD_ID` (the acting thread) through the same `harness_session_id` alias BEFORE the contaminated
      `SPEXCODE_SESSION_ID` — so both the hook writes and the interactive declarations hide this until measured
      through a real codex round-trip, not a synthetic Bash-only payload.
    code: spec-cli/hooks/harness.sh
  - name: codex-delivery-steers-midturn-and-resumes
    tags: [backend-api]
    description: >-
      Through a REAL codex session on the project app-server, exercise the adapter's deliver + resume. (a) While
      the agent is MID-TURN (an `inProgress` turn — a long-running tool call), `spex session send` a message and
      watch the codex pane: the model must react WITHIN the same running turn, not after it stops. (b) While the
      agent is IDLE, send again — it must still land. (c) Kill the tmux window and `reopen`: the relaunched TUI
      must show the SAME prior conversation (unchanged captured thread id), not a blank new thread.
    expected: >-
      deliver reads the live thread (`thread/read{includeTurns}`) and chooses `turn/steer` when a turn is
      `inProgress` — the injected message lands mid-turn (the agent acknowledges it while its background command
      is still running, reporting a step SHORT of the final one) and the turn continues — and `turn/start` when
      idle (the message still lands). The failure this locks: always `turn/start` QUEUES a busy agent's message
      until the current turn ends, so a human's mid-turn steer is silently delayed instead of injected "right
      after the running tool call completes". `reopen` relaunches `codex resume <captured-thread-id>` so the
      prior conversation is present and `harness_session_id` is unchanged — the SAME conversation, matching
      claude's `--resume`, not a fresh thread.
    code: spec-cli/src/harness.ts
  - name: codex-liveness-reflects-live-tui-not-sock
    tags: [backend-api]
    description: >-
      Through a REAL codex launch, read liveness for the three real shapes. (a) HEALTHY: a codex session whose
      TUI is up and rendering — note its pane's `pane_current_command` is `bash` (the launch wrapper; the codex
      processes are the pane pid's DESCENDANTS: bash → node (the codex CLI) → the vendored codex binary). (b)
      FAILED: the macmini shape — the shared per-project app-server socket is bound but THIS session's visible
      `codex --remote … resume <tid>` TUI FAILED and, after its bounded retries, the launch pane dropped back to
      an idle shell — nothing below the pane pid. (c) BOOTING: a just-launched pane inside the boot-grace
      window. Read the board / `spex ls` for each.
    expected: >-
      HEALTHY reads **online**, because codex liveness keys on a codex-ish process (basename codex*/node*) being
      live in the pane pid's DESCENDANT tree — NOT on the pane's foreground command name, which is `bash` for
      the TUI's whole life. FAILED reads **offline** (NOT online/working) despite the still-bound shared sock.
      BOOTING reads **starting**, not offline. The TWO failures this locks, one per wrong signal: (1)
      sock-presence read the dead launch as online/working (the SHARED sock survives a failed `--remote
      resume`), so the supervisor treated a never-started worker as live; (2) the foreground-name probe
      (online iff `pane_current_command` == codex) FALSE-read every HEALTHY codex as offline — field-confirmed:
      a rendering TUI's foreground is the bash wrapper — so the board showed working codex sessions as dead and
      a supervisor could wrongly reopen/kill them. Both are measurable only through a real launch (a synthetic
      pane hides the wrapper-shell tree shape).
    code: spec-cli/src/harness.ts
  - name: codex-app-server-sock-binds-on-hardened-tmp
    tags: [backend-api]
    description: >-
      On a normally-hardened Linux host (`fs.protected_regular=2`, root-owned sticky `/tmp` — stock Ubuntu), with
      NO `SPEXCODE_CODEX_SOCKET_DIR` override set: derive the app-server socket path exactly as the launch path
      does (`codexAppServerSock`), then run the launch script's own spawn — `codex app-server --listen
      unix://<sock>` — and the client's `connect()` against it. Control: the SAME codex binding the SAME filename
      inside an owned 0700 subdirectory.
    expected: >-
      The default-derived socket binds and accepts a connect out of the box — no env knob required. The failure
      this locks (github#30): the derivation defaulted to BARE `tmpdir()`, and codex (≥0.137 field-confirmed,
      0.142.5 reported) refuses to bind a unix socket directly in the shared sticky `/tmp` — `Error: Operation
      not permitted (os error 1)` — so the server never comes up, the client's connect gets ENOENT, and launch.sh
      burns all its retries: EVERY codex-launcher session on a fresh hardened install dies with `codex app-server
      connection failed: connect ENOENT /tmp/spexcode-cx-<hash>.sock` while claude launchers work — yet the same
      codex binds fine in any OWNED subdirectory (the control), so the fix belongs to the path derivation, not
      the host.
    code: spec-cli/src/harness.ts
  - name: codex-dispatched-thread-fires-lifecycle-hooks
    tags: [backend-api]
    description: >-
      Through the REAL dashboard/app-server launch path (NOT `codex exec`, whose interactive approval flow
      AUTO-TRUSTS the cwd and hides the gap): dispatch a codex worker into a FRESH-INIT project (no skill nodes)
      and trace `dispatch.sh` across its first turn, then read session.json and the worker's commit. The worker
      runs as a BACKEND-owned thread on the shared per-project app-server with `cwd = a linked worktree`, launched
      with `--dangerously-bypass-hook-trust`.
    expected: >-
      The codex thread fires the full lifecycle through `dispatch.sh` — SessionStart, UserPromptSubmit, PreToolUse,
      PostToolUse, Stop — with NO interactive "Hooks need review" prompt; session.json advances past the launch
      state (the Stop gate flips it to `asking`/`awaiting`/`idle`); and the worker's commit carries the `Session:`
      trailer. This requires THREE codex preconditions that `--dangerously-bypass-hook-trust` does NOT provide, all
      established by materialize (bypass is read only PER-HANDLER, after layer discovery — it can neither BUILD nor
      ENABLE a layer): (a) the worktree carries a `.codex/` ANCHOR so codex builds a project layer for the worktree
      cwd (whose hooks-folder rewrites to the main-checkout shim); (b) `[projects."<mainCheckout>"] trust_level =
      "trusted"` ENABLES that layer (codex drops a disabled/untrusted layer before discovery, and the app-server
      does NOT auto-trust); (c) per-hook `trusted_hash` blocks make the hooks "reviewed", because our `codex resume`
      TUI is a PERSISTENT RESUME on which codex forces the hook-review prompt regardless of the bypass flag — an
      unhashed hook WEDGES the worker at an interactive menu. The failure this locks (the real regression): with the
      bypass sent but the anchor/trust/hashes missing, a fresh-init codex worker fires ZERO dispatch events (frozen
      session.json, no Stop gate, no Session trailer), while a STANDALONE `.codex` in the cwd — which the exec/TUI
      flow auto-trusts — still fires them, so a standalone or exec-only check passes green and the dispatched-worker
      regression hides. Provable only by dispatching a REAL worker into a fresh-init project and tracing dispatch +
      reading session.json + the commit trailer.
    code: spec-cli/src/harness.ts
---
# eval.md — harness-adapter

The adapter's whole job is that the user-facing spec hooks ([[inject-spec-first]], [[inject-spec-of-file]], mark-active) behave
identically whichever harness the user runs. The load-bearing, easy-to-miss divergence is codex's **two-tool code
model** — a shell read is `tool_name:"Bash"`, but an edit is a distinct `tool_name:"apply_patch"` carrying the bare
patch envelope — which a synthetic Bash-only payload does not exercise (the first cut shipped green against synthetic
Bash and was inert on real apply_patch edits). So this is measured the YATU way: through a real codex session that
actually edits via apply_patch, comparing the spec-of-file ledger + spec-first sentinel to the Claude baseline. The
trust / zero-prompt-launch half of the adapter is measured by [[harness-delivery]]'s `self-launch-zero-friction-codex`.

The adapter's OTHER user-observable behaviour is **prompt delivery**: the dashboard input must reach a live codex
session the way a human expects — injected INTO the running turn when the agent is busy (steer), not parked behind it.
That is a separate code slice (`harness.ts`'s app-server JSON-RPC), so it carries its own scenario and stales
independently of the shell-mirror payload parse. It too is measured the YATU way — a real codex session driven busy,
steered mid-turn through the real `spex session send` surface, then killed and `reopen`ed to prove the conversation
resumes — never a synthetic socket stub, which would prove only that bytes were written, not that codex acted.
