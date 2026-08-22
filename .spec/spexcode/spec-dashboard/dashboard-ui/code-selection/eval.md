---
scenarios:
  - name: prompt-token-round-trip
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/source-selection.e2e.mjs
    description: >-
      Use the real dashboard composer after selecting governed source. Verify the structured selection
      metadata is rendered as a chip, surrounding intent remains editable, and removing the chip leaves no
      selection token in the visible prompt before the ordinary launch submit.
    expected: >-
      The prompt token decodes to the exact path, inclusive line range, and source text; malformed data would
      remain visible rather than disappearing. The chip is removable, and the final edited prompt is sent by
      the existing New Session launch path without an API or session-schema extension.
---
# eval.md - code-selection

Measure the token at the product boundary as well as with its narrow parser tests: the browser scenario proves
that the prompt attachment survives the viewer-to-composer handoff and that removal changes what is dispatched.
