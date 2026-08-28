---
scenarios:
  - name: no-stretch-of-work-is-dropped
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/conversationItems.js, spec-dashboard/src/conversationItems.test.mjs, spec-dashboard/test/fixtures/conversation-tail.scenarios.mjs, spec-dashboard/test/conversation-working-tail.e2e.mjs]
    description: >-
      Run the shared scenario table through both instruments: the derivation directly (the unit test, which
      also walks two thousand generated timelines over the status machine's whole vocabulary — bare and
      noted `active`, asking, parked, close-pending, error, human and peer messages — in random order), and
      the rendered Conversation in a real browser, one fresh page per shape, reading the rows after the
      prompt in order and clicking the live tail.
    expected: >-
      Both instruments agree with the table on every shape. Over the generated timelines the theorem holds
      on each: the record's last word `working` ⟹ the last item is an open seam, otherwise no item is open;
      every message and every noted or non-working status is exactly one item in wire order; seams never
      touch and each lasts. In the browser the working session's last row is one live seam that opens on
      click, mid-history messages into a working agent are followed by a closed `worked` seam, and shapes
      that were already right render exactly as before.
---

# measuring conversation items

Two instruments, one table. `node --test src/conversationItems.test.mjs` is the derivation-level reading;
`test/conversation-working-tail.e2e.mjs` (PHASE=B against the worktree dashboard) is the product-level one.
File the browser run's screenshots and `facts.json` together with the unit run's output as the evidence.
