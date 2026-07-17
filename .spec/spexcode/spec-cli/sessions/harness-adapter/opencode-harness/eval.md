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
---

Measured YATU through the generated artifacts and the real CLI: the plugin file the adapter actually
materializes is loaded and driven as opencode would drive it; adoption goes through the real `spex init`
in a scratch repo. The e2e scenario runs through a real dispatched opencode worker once credentials exist.
