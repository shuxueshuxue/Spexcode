---
scenarios:
  - name: two-speakers-on-one-event-yield-one-document
    tags: [cli]
    test:
      path: spec-cli/src/hook-dispatch.test.ts
      name: two handlers on one event produce ONE parseable document, not two concatenated
    description: >-
      Through the real dispatch.sh, bind two handlers to one PostToolUse event that both emit the structured
      `hookSpecificOutput.additionalContext` contract, and read the raw stdout a harness would receive. Parse
      it as a single JSON document.
    expected: >-
      The stdout parses as ONE document carrying BOTH handlers' context joined in manifest order, rather than
      two documents concatenated into text no harness can parse. Neither handler is silenced by the other.
  - name: a-block-survives-the-fold
    tags: [cli]
    test:
      path: spec-cli/src/hook-dispatch.test.ts
      name: a block from either speaker survives the fold, and a decision cannot be downgraded
    description: >-
      Bind a context-only handler and a blocking handler to the same event and read the folded document.
    expected: >-
      The folded document keeps `decision: block` with its reason, and still carries the other handler's
      additionalContext. A neighbouring handler cannot downgrade a block it did not issue.
  - name: one-speaker-is-unchanged-passthrough
    tags: [cli]
    test:
      path: spec-cli/src/hook-dispatch.test.ts
      name: one speaker is byte-identical to the old passthrough, and non-JSON stdout still passes through
    description: >-
      Fire an event whose handlers produce exactly one structured document, then one whose handlers produce
      plain text plus one document, and compare the raw stdout byte for byte.
    expected: >-
      Both are byte-identical to the streaming implementation's output, so the common dispatch pays nothing
      for the fold and boots no CLI. Plain text keeps its position ahead of the document.
  - name: unknown-key-collision-is-reported-not-resolved
    tags: [cli]
    test:
      path: spec-cli/src/hook-dispatch.test.ts
      name: two speakers disagreeing on an unknown key keep the first and say so
    description: >-
      Bind two handlers that set the same field, one this node has no merge rule for, to different values.
    expected: >-
      The first handler's value is kept and the collision is named on stderr, so a handler disarmed by a
      neighbour it never knew about is a reported event rather than a silent one.
---
# eval.md — output-fold

The loss is a handler that ran, wrote what it meant to write, and was discarded anyway because a neighbour
wrote too — invisible from either handler's side, and impossible to distinguish afterwards from a handler
that never ran.
