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
      YATU: dispatch a pi worker with a trivial one-turn prompt and let it settle undeclared. The Stop gate
      blocks the claude way — `{"decision":"block","reason":…}` on dispatch stdout, exit 2, stderr EMPTY —
      so this measures whether the generated extension carries a stdout-JSON rejection back into the
      session (agent_settled) and into a specific PreToolUse block reason (tool_call).
    expected: >-
      Right after the turn settles, the gate's reason text lands in the pi session as an injected user
      message; the agent declares (`spex session …`) and session.json flows out of `active` to the declared
      status (asking/awaiting). A PreToolUse block carries the handler's own reason, not a generic
      placeholder. The failure signature is a record stuck `active` forever with `stop-gate-taught` present
      and a frozen timeline — the rejection silently dropped.
  - name: pi-pretooluse-block
    tags: [backend-api]
    description: >-
      YATU: in an adopter repo, add a temporary `surface: hook` node (events [PreToolUse], block: true)
      whose script emits `{"decision":"block","reason":…}` on stdout for a marked path, materialize, then
      dispatch a pi worker told to touch that path. Remove the node after.
    expected: >-
      The tool call is genuinely blocked — the forbidden file is never touched — and the agent sees the
      handler's OWN reason text (visible in the pane), not a generic placeholder; the session continues
      normally after the block.
  - name: pi-ask-note
    tags: [backend-api]
    description: >-
      YATU: a dispatched pi worker runs `spex session ask --note '<question>'` as its declaration.
    expected: >-
      The record flips to `asking` and the note carries the question verbatim where the board reads it
      (`session ls` / the graph payload).
  - name: pi-deliver-steer
    tags: [backend-api]
    description: >-
      YATU: `spex session send` to an IDLE pi session, then a second send while a turn is RUNNING
      (pi delivers via `sendUserMessage {deliverAs: steer}` over the rendezvous socket).
    expected: >-
      The idle send exits 0 and lands as EXACTLY ONE injected user message that starts a new turn; the
      mid-turn send also lands exactly once, steering the LIVE turn (its effect visible in that same
      turn's output) — never dropped, never duplicated.
  - name: pi-resume
    tags: [backend-api]
    description: >-
      YATU: `spex session stop` a pi session (worktree kept), then `spex session resume` it — the relaunch
      rides `pi --session <id>`.
    expected: >-
      The resumed TUI continues the SAME pi conversation — prior turns are present and referencable (the
      agent can answer from earlier context) — never a fresh empty session; a missing session file fails
      loud rather than silently minting a new one.
  - name: pi-liveness
    tags: [backend-api]
    description: >-
      YATU: kill the pi TUI process of a live session (the rendezvous listener dies with it), read board
      liveness; then resume and read again.
    expected: >-
      Liveness reads `offline` within seconds of the kill (the socket connect probe refuses — the stale
      socket FILE never reads as alive); after resume it reads `online` again.
  - name: pi-commit-gate
    tags: [backend-api]
    description: >-
      YATU: a dispatched pi worker with UNCOMMITTED files runs `spex session done --propose merge`.
    expected: >-
      The declaration is rejected and the reason names the uncommitted work (the commit-before-declare
      contract), delivered into the session so the agent acts on it; after committing, the same proposal
      is accepted.
  - name: pi-close-residue
    tags: [backend-api]
    description: >-
      YATU: `spex session close` a pi session, then sweep for residue: tmux window, pi process tree,
      worktree, rendezvous socket, session record.
    expected: >-
      Zero residue — the tmux window is gone, no pi process of that session survives, the worktree and
      node branch are retired, and the rendezvous socket path is unlinked.
---
