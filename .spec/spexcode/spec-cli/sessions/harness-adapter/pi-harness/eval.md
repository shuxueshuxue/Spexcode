---
scenarios:
  - name: pi-materialize-full-footprint
    tags: [backend-api]
    description: >-
      In a fresh adopter repo (isolated SPEXCODE_HOME + SPEXCODE_PI_AGENT_DIR), run `spex init`, then inspect
      the pi footprint: the generated `.pi/extensions/spexcode.ts`, the `.pi/skills/*` products, the per-clone
      exclude, and pi's global trust store. Then `spex uninstall` and inspect again.
    expected: >-
      init materializes `.pi/extensions/spexcode.ts` (carrying the dispatch.sh identity stamp and the five
      event handlers) plus the skill products; every `.pi/**` artifact is git-ignored via the per-clone
      exclude (git check-ignore matches, `git status` clean); `~/.pi/agent/trust.json` gains exactly one
      `"<mainCheckout>": true` entry with other projects' decisions untouched. uninstall removes the
      extension, the skills, the trust entry, AND the now-empty `.pi` directory tree — zero residue.
  - name: pi-dispatched-worker-full-loop
    tags: [backend-api]
    description: >-
      YATU: from a running backend, create a session with a `{ "harness": "pi" }` launcher and watch the
      whole loop — launch (`pi --approve --session-id <id> "<prompt>"`), the extension's hooks reaching
      dispatch.sh (mark-active flips the record, the Stop gate holds an uncommitted declare), board liveness
      from the rendezvous socket, `spex session send` delivery landing as a user message, and
      reopen resuming the SAME pi conversation (`--session <id>`).
    expected: >-
      The worker launches with zero trust prompts; session.json advances past launch (SessionStart …
      Stop fire through dispatch.sh with SPEXCODE_HARNESS=pi); the commit carries the `Session:` trailer;
      liveness reads online while the pane lives and offline within seconds of a kill; a delivered prompt
      appears in the pi TUI as a user turn (repaint-done confirmed); resume brings back the same
      conversation, not a fresh session.
  - name: stop-gate-bridge
    tags: [backend-api]
    description: >-
      Live-behavior matrix row (run by `spex eval matrix <launcher>`): dispatch a real worker of
      this harness with a controlled prompt that answers one line and stops WITHOUT declaring, then
      watch the settle from the outside — no steering, no help.
    expected: >-
      The stop-gate's rejection reaches the session — the gate's teach sentinel is planted and the
      record flows out of `active` into a declared status (asking/review) on its own. The failure
      signature is a record stuck `active` forever with the rejection silently dropped.
  - name: pi-pretooluse-block
    tags: [backend-api]
    description: >-
      Matrix row: plant a transient `surface: hook` node (PreToolUse, block: true) guarding one
      marked file in the live worker's worktree, `spex materialize` there, then tell the worker to
      modify the guarded file; sweep the node and re-materialize afterwards.
    expected: >-
      The tool call is genuinely blocked — the guarded file's content is untouched — and the
      handler's OWN reason (a unique marker) is visible to the agent, who reports it; the session
      continues normally after the block.
  - name: pi-ask-note
    tags: [backend-api]
    description: >-
      Matrix row: the live worker runs `spex session ask --note '<question>'` (its own declaration
      verb, from inside its worktree) with a unique marker in the note.
    expected: >-
      The record flips to `asking` with the note carried verbatim where the board reads it (`spex
      session show`), attributed to the right record.
  - name: pi-deliver-steer
    tags: [backend-api]
    description: >-
      Matrix row: `spex session send` a task to the settled (idle) worker that starts a long turn,
      then send a SECOND message while that turn is in flight — all under normal board-probe
      pressure (the runner polls the board throughout).
    expected: >-
      Both sends exit 0; the idle send lands EXACTLY once (no duplicate injection of the message
      text); the mid-turn send reaches the LIVE turn — its steer marker shows in that same turn's
      output — never dropped, never duplicated.
  - name: pi-resume
    tags: [backend-api]
    description: >-
      Matrix row: seed the live worker with a token to remember, `spex session stop` it (tmux
      killed, worktree kept), `spex session resume` it, then ask for the token back without
      repeating it.
    expected: >-
      The resumed agent continues the SAME conversation — it answers with the seeded token from
      prior context in a fresh RECALL=<token> line — never a fresh empty session; the board returns
      to online.
  - name: pi-liveness
    tags: [backend-api]
    description: >-
      Matrix row: SIGKILL an ESTABLISHED agent's whole process tree out from under the pane (the
      kill lands outside the launcher boot-grace window; the tmux window and any stale socket file
      stay), read board liveness until it flips; then `spex session resume` and read again.
    expected: >-
      Liveness reads `offline` within seconds of the kill — a stale socket FILE never reads as
      alive; the adapter's own per-harness signal decides — and after resume the session reads
      online again.
  - name: pi-commit-gate
    tags: [backend-api]
    description: >-
      Matrix row: the runner plants an uncommitted file in the live worker's worktree and the worker
      runs `spex session done --propose merge`; the gate must reject the dirty proposal, and a
      committed re-proposal must be accepted.
    expected: >-
      The dirty proposal is rejected at settle with the reason delivered into the session (the
      record never stands as review while the tree is dirty); once the work is committed the same
      proposal is accepted (status review) and the commit carries the `Session:` trailer attributing
      it to this record.
  - name: pi-close-residue
    tags: [backend-api]
    description: >-
      Matrix row: `spex session close` the worker, then sweep the box — tmux window, surviving
      processes of that worktree, the worktree directory and node branch, the session record and its
      global store dir.
    expected: >-
      Zero residue: the tmux window is gone, no process of that worktree survives, worktree and
      branch are retired, and the session's record/store dir is swept (durable history lives in git
      and the eval filings, not the record).
---
