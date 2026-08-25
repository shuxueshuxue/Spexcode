---
scenarios:
  - name: authoring-wrap-reflows-by-content-kind
    tags: [frontend-e2e, desktop]
    code: spec-dashboard/src/proseTokens.js
    related:
      - spec-dashboard/src/Prose.js
      - spec-dashboard/src/RichText.js
      - spec-dashboard/src/TimelineChat.jsx
      - spec-dashboard/test/spec-markdown.e2e.mjs
    description: >-
      In Chromium against the running dashboard, open three real surfaces holding real authored prose: a spec
      node whose body its author hard-wrapped (`#/spec/session-protocol`), an issue detail carrying replies,
      and a session's conversation surface. On each, count the `<br>` the prose renderer emitted and the
      paragraphs whose `innerText` still contains a newline, and read the first spec paragraph back in full.
      Drive the committed `spec-markdown.e2e.mjs` fixture too, at 1280x800 and 900x844, for the wrap and the
      authored hard break side by side.
    expected: >-
      The document surfaces — the spec body, the issue body, its replies — emit zero `<br>` and leave no
      paragraph carrying a newline: an editor's wrap reflows into a space, so a wrapped sentence reads back as
      one continuous line of prose rather than breaking mid-clause. The session transcript is untouched and
      keeps its breaks, `<br>` present and paragraphs still carrying newlines, because a newline typed
      mid-conversation is content and not typography. On every surface an authored hard break — two trailing
      spaces or a backslash — still breaks.
  - name: timeline-selection-copy-migration-gate
    tags: [frontend-e2e, desktop, mobile]
    test:
      path: spec-dashboard/test/timeline-chat-interaction.e2e.mjs
      name: TimelineChat selection/copy migration gate
    code: spec-dashboard/test/timeline-chat-interaction.e2e.mjs
    related:
      - .spec/spexcode/spec-dashboard/dashboard-ui/ui-primitives/prose-renderer/migration-payload.md
      - spec-dashboard/src/TimelineChat.jsx
      - spec-dashboard/src/RichText.js
    description: >-
      Against two parked real headless fixtures, open TimelineChat in Chromium at 1280x800 and 390x844 only
      after the real timeline GET succeeds. Run NORMAL, stationary WORD, continuing WORD drag, and LINE selection;
      prove every coordinate still hits the same rich row before and after its action and a timeline poll. Exercise
      immediate composer editing, plain click, Escape, composer press, the prompt summary, the second warm sink,
      and Ctrl/Cmd+C. Repeat the complete two-viewport run three consecutive times and record video plus the
      runner's result and time-axis step map.
    expected: >-
      All three runs pass. The rich fixture contains inline code, a link, and math. Selection ranges are exact,
      LINE intersects every nested fixture kind, continuing WORD drag never collapses to its landing word, native
      document Selection stays empty, and the same composer remains focused and editable throughout. DOM facts
      prove only hit identity and geometry. Clipboard text equals the test's hardcoded user-facing literal, never
      a DOM-derived expectation, and the authored formula occurs exactly once.
---

Measure through the worktree dashboard and real Chromium, using parked headless fixtures that receive no input
during the run. This is a dynamic interaction gate, so file the recorded video with its runner-exported time-axis
timeline and structured result.
