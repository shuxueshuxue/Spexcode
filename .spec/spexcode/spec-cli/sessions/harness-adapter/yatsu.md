---
scenarios:
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
      Through a REAL codex launch, construct the FAILED-launch state the macmini reported: the shared per-project
      app-server socket is bound (a prior/parallel codex is up, or the app-server started) but THIS session's
      visible `codex --remote … resume <tid>` TUI FAILED and, after its bounded retries, the launch pane dropped
      back to the shell prompt — no codex TUI. Read the board / `spex ls` for that session. Then launch a codex
      session whose TUI comes up normally and read it again.
    expected: >-
      The failed launch reads **offline** (NOT online/working), because codex liveness now keys on the pane's
      `pane_current_command` being codex, not on the shared app-server socket existing. The healthy session reads
      **online**. The failure this locks: keying liveness on sock-presence read the dead launch as online/working
      because the SHARED sock survives a failed `--remote resume`, so the supervisor was misled into treating a
      never-started worker as live — measurable only through a real failed launch, since a synthetic sock-present
      state hides it. A fresh, still-booting codex pane (bash bootstrapping the app-server before it `exec`s the
      TUI) must read **starting**, not offline, for the boot-grace window — the fix must not flap a legitimate
      startup to offline.
    code: spec-cli/src/harness.ts
---
# yatsu.md — harness-adapter

The adapter's whole job is that the user-facing spec hooks ([[spec-first]], [[spec-of-file]], mark-active) behave
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
