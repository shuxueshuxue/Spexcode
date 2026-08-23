---
scenarios:
  - name: page-kind-slot-regression
    description: >
      Open the running dashboard in a real browser. From a session document, use the Explorer to open the
      tab-strip spec and confirm both documents remain; navigate from one spec to another and confirm the
      spec slot is replaced while the session remains; click three session rows in the dock and confirm one
      session tab is reused; ctrl-click a session row and confirm it creates a pinned tab; open Settings and
      confirm its tab label is Settings.
    expected: >
      The strip contains both a session and the opened spec after the cross-kind navigation. A second spec
      replaces the first spec in its same-kind slot. Three plain session clicks leave one session tab whose
      address is the last session. Ctrl-click adds a second non-slot session tab. The Settings tab reads
      Settings, never the internal key tabs.settings.
    tags: [frontend-e2e]
    code: [spec-dashboard/src/tabModel.js, spec-dashboard/src/TabStrip.jsx]
---

Measure YATU through the Vite dashboard in this worktree and a real browser against the running Spex backend.
Use screenshots of each settled end state as evidence for the static strip contents and labels.
