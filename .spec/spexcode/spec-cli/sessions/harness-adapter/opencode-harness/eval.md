---
scenarios:
  - name: plugin-bridge-mechanical
    tags: [cli]
    code: spec-cli/src/opencode.ts
    test:
      path: spec-cli/src/opencode.test.ts
      name: whole file
    description: >-
      Run the mechanical layer end to end WITHOUT an opencode binary: generate the plugin with
      opencodePluginSource, load it, and drive its hooks with a stub dispatch.sh (recording every payload,
      blockable per event) and a fake SDK client. Also branch the launch script against a stub `opencode` on
      PATH, and deliver a prompt with the REAL deliverViaRendezvous against the plugin's own socket server
      (`npx tsx --test spec-cli/src/opencode.test.ts`).
    expected: >-
      Every payload reaching dispatch.sh is claude-SHAPED (session_id = the governed record id, Claude tool
      names, filePath→file_path) with the harness id `opencode` as argv[1]; a child session's events carry
      agent_id BEFORE tool_input (the harness.sh prefix-scan contract); a PreToolUse block THROWS and a Stop
      block re-injects the gate reason as a prompt (the stop-gate loop); the launch script maps a prompt tail
      to --prompt, a --resume marker to --session <id>, a --continue marker to --continue; and
      deliverViaRendezvous returns parse-CONFIRMED ok with the text landing in the session — claude's
      transport reused verbatim, zero opencode transport code.
  - name: adopted-repo-grows-opencode-artifacts
    tags: [cli]
    description: >-
      In a throwaway git repo, run the real `spex init .`, inspect the tree, then narrow spexcode.json's
      `harnesses` to ["claude","codex"] and re-run `spex materialize`.
    expected: >-
      init materializes .opencode/plugins/spexcode.ts (the generated plugin, dispatch.sh command baked), the
      AGENTS.md managed block, and .opencode skill artifacts, all exclude-hidden; narrowing the set prunes
      every .opencode artifact AND sweeps the emptied .opencode/ home itself — the third native harness rides
      the same select/erase/assert pipeline with no special case.
  - name: deliver-second-message
    tags: [backend-api]
    code: spec-cli/src/opencode.ts
    description: >-
      Through the running product: dispatch an opencode worker, let it answer its first prompt, then
      `spex session send` a SECOND message while the board liveness probe keeps connecting to the
      rendezvous socket (every graph snapshot fires rendezvousListening — collisions are the norm, not
      an edge). Read the send's exit code/output and count how many copies of the message the worker's
      pane actually received.
    expected: >-
      The send exits 0 ("sent") and the pane shows the message injected exactly ONCE. The plugin's
      daemon must answer the reply+repaint chunk with parse-confirmed repaint-done in the same
      synchronous parse pass — never suspended on the prompt-injection await — so a concurrent probe
      connect can't kick the connection between parse and confirm. A kicked-3× failure with the text
      nonetheless landing (false negative → caller retries → duplicate injections) is the bug this
      scenario guards against.
  - name: dispatched-opencode-worker-e2e
    tags: [backend-api]
    description: >-
      Through the running product: add an opencode launcher ({"harness":"opencode","cmd":"opencode --auto"}),
      dispatch a worker onto a node task, and watch the whole lifecycle — SessionStart/mark-active flip the
      board to working, the plugin's first event stores harness_session_id, an undeclared stop is BLOCKED by
      the stop-gate with the reason re-injected, `spex session send` lands mid-run, kill + resume re-attaches
      the SAME opencode conversation (--session <id>), and the commit carries the Session trailer.
    expected: >-
      Indistinguishable from a claude worker on the board and in git: live status honest (socket-preferred,
      pid-fallback), deliver confirmed, resume continuous, declarations attributed to the right record.
      NOTE: needs a box with opencode model credentials — unmeasured where none exist (this box, 2026-07-16);
      the mechanical layer above is measured, this end-to-end reading is the open item.
  - name: undeclared-stop-gate-rejection
    tags: [backend-api]
    code: spec-cli/src/opencode.ts
    description: >-
      Through the running product: dispatch a real opencode worker on a trivial task and let it answer
      WITHOUT declaring. Its session.idle fires the plugin's Stop dispatch; the stop-gate emits
      decision:block. Read the pane/conversation for what the plugin injected, and the store
      record/timeline for the state flow that follows.
    expected: >-
      The rejection is never dropped (the pi-harness lesson): the gate's block visibly re-enters the
      conversation via client.session.prompt, the agent reacts to it with a real declaration
      (done/ask/park), and the board flows out of `active` into the declared state. The injected text is
      the gate's REASON — human-readable teaching prose with its newlines intact — not the raw
      {"decision":"block",...} wire JSON (claude renders the reason field, codex gets the stderr bridge;
      opencode must not be the one harness whose agent reads escaped wire format).
  - name: pretooluse-block-live
    tags: [backend-api]
    code: spec-cli/src/opencode.ts
    description: >-
      Against a LIVE opencode worker: drop a temporary surface:hook node (PreToolUse, block:true,
      guarding one specific path) into the worker's worktree .plugins, run spex materialize there
      (dispatch.sh re-reads the tree-slot manifest per event — no opencode restart), then tell the agent
      to touch the guarded path. Remove the node + re-materialize afterwards.
    expected: >-
      tool.execute.before throws on the guarded touch: the tool call is genuinely aborted (the guarded
      file never changes) and the hook's reason is visible to the agent in the conversation, who reports
      being blocked. After the node is removed and the manifest recompiled, the same touch passes —
      the block was the manifest's doing, live-toggleable without relaunching the harness.
  - name: ask-note
    tags: [backend-api]
    description: >-
      A live opencode worker runs `spex session ask --note '<question>'` (its own worker verb, from
      inside the worktree with no --session flag). Read the board and the store record.
    expected: >-
      The record flips to asking with the note stored verbatim; `spex session ls` shows status asking
      plus the note text; the concurrency slot frees (asking waits cheap). The CLI's confirmation text
      is shown to the agent so it knows the claim landed.
  - name: deliver-mid-turn
    tags: [backend-api]
    description: >-
      `spex session send` to an opencode worker while a turn is IN FLIGHT (the agent mid-answer), under
      normal board-probe pressure. Compare with deliver-second-message (the idle-send reading): count
      injected copies in opencode's message store and read the send's exit code.
    expected: >-
      The send exits 0 with parse-confirmed "sent" — the daemon confirms at parse time even though the
      injection queues behind the running turn — and the message lands exactly ONCE, answered when the
      current turn ends. No duplicate injection, no false negative.
  - name: resume-continuity
    tags: [backend-api]
    description: >-
      Seed a live opencode worker with a token to remember, `spex session stop` it (tmux killed, worktree
      kept), then `spex session resume` and ask for the token back. Repeat the cycle with the record's
      harness_session_id cleared to force the --continue fallback route.
    expected: >-
      Resume relaunches via the --resume <id> marker → `--session <id>`: the SAME opencode conversation
      continues (the token is recalled, the message history is one thread). With harness_session_id
      absent the --continue marker re-attaches opencode's last session in the worktree — same
      conversation again, both routes continuous, and the board returns to online/working.
  - name: liveness-signals
    tags: [backend-api]
    description: >-
      Kill a live opencode worker's TUI process out from under the board, read the board's liveness;
      relaunch via resume and read it again. Check both signals: the plugin's rendezvous socket listener
      (preferred) and the launch-registered agent.pid kill-0 fallback.
    expected: >-
      Dead TUI reads offline promptly (no immortal `working`); after resume the session reads online
      again with a live socket listener AND a fresh agent.pid. A plugin that failed to load would still
      read honestly from the pid signal — the fallback exists and the preferred signal is the socket.
  - name: commit-gate-rejection
    tags: [backend-api]
    description: >-
      A live opencode worker with UNCOMMITTED work on its node branch declares
      `spex session done --propose merge` and stops. Watch the Stop dispatch, the injected text, and
      the record's final state.
    expected: >-
      The stop-gate rejects the dishonest proposal: the block reason re-enters the conversation naming
      the uncommitted files and the commit-first ritual; the session never stands as a false
      review/done — it either commits and re-declares, or the gate's escape downgrades it to asking.
  - name: close-residue
    tags: [backend-api]
    description: >-
      `spex session close` a live opencode worker (proposal or not), then sweep the box: tmux -L
      spexcode sessions, surviving opencode processes for that worktree, the .worktrees/ entry, the
      node branch, and the rendezvous socket dir.
    expected: >-
      Zero residue: the tmux session is gone, no opencode process for that worktree survives, the
      worktree directory and node branch are removed, and the per-session rendezvous socket is swept.
      The global store dir dies with the session (close is retirement — the documented sweep; durable
      history lives in git and the eval filings, not the record).
---

Measured YATU through the generated artifacts and the real CLI: the plugin file the adapter actually
materializes is loaded and driven as opencode would drive it; adoption goes through the real `spex init`
in a scratch repo. The e2e scenario runs through a real dispatched opencode worker once credentials exist.
