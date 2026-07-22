---
scenarios:
  - name: rawkey-batch-preserves-strike-order
    tags: [backend-api]
    description: >-
      Start the real backend against a scratch tmux socket and a session running a shell. Through the real
      POST /api/sessions/:id/input route send `{kind:'keys', keys:[…]}` with a long known sequence, then
      capture the pane and compare the received characters to the supplied array.
    expected: >-
      Every valid character lands exactly once and in array order, with no drop, duplicate, or transposition.
      Unknown tokens fail or skip honestly without reordering later valid tokens.
---

Measure through the real HTTP route and tmux pane; the raw-key fallback is not proven by a stubbed sender.
