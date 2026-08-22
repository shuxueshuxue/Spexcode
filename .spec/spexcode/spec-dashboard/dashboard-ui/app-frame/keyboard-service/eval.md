---
scenarios:
  - name: shell-global-routing-and-tab-commands
    tags: [frontend-e2e, desktop]
    description: >-
      Through a real Chromium dashboard, open `#/spec/<id>` and press the physical Alt page commands,
      `/`, and `,`; verify the route or palette changes while the shell stays mounted. On the graph, click
      a non-root node, use ArrowDown for relationship navigation, Enter for the info popup, and Shift+ArrowDown
      for the lens walk. Seed two document tabs in local storage, then use Alt+Shift+ArrowRight/Left/X to
      select next/previous and close. Capture the settled spec palette and graph lens frames.
    expected: >-
      Alt+1..5, slash search, and settings comma work from a non-graph document; the graph relationship walk
      and popup lens retain their prior behavior; and the new tab commands operate on the existing route/tab
      state without stealing Ctrl/Meta browser accelerators. The shell has one capture listener and no
      duplicate view-owned global dispatch is observable.
---
