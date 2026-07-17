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
---
