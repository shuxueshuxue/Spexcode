---
scenarios:
  - name: rich agent reply stays safe and contained
    description: |
      Open a real headless TimelineChat containing headings, emphasis, links, lists, a table, fenced code,
      inline and display mathematics, a remote Markdown image, malformed math, raw HTML, an unsafe URL, and long
      overflowing content.
    expected: |
      Markdown, the remote image, and valid mathematics render legibly; code and tables retain their structure;
      malformed math remains readable; raw HTML and unsafe links cannot execute; and no image, prose, table, code
      block, or display equation widens or overlaps the desktop or mobile conversation pane. Selecting a complete
      rendered formula and copying the timeline range yields its authored TeX once, with no duplicated KaTeX DOM
      representation and no composer focus handoff. A range ending inside one visual formula treats that math
      token atomically and copies the same complete authored source once.
    tags: [frontend-e2e, desktop, mobile]
    code:
      - spec-dashboard/src/RichText.js
    related:
      - spec-dashboard/src/TimelineChat.jsx
      - spec-dashboard/src/styles.css
    test:
      path: spec-dashboard/test/rich-conversation.e2e.mjs
      name: rich agent reply stays safe and contained
---

Measure through the running dashboard in real desktop and phone-sized browsers. Use screenshots for the settled
rendered states; automated DOM/security, exact formula-copy, and production bundle measurements are supporting
evidence.
