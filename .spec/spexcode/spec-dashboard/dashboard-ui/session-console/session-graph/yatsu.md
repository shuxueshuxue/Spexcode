---
scenarios:
  - name: relationship-tab-renders
    description: >-
      Open the dashboard, press Enter to open the session console, then select the "View Session
      Relationship" tab — the network-glyph button paired with ＋ New Session, or press → from an
      empty New Session. Look: the right pane fills with the live monitor graph. Each live session
      is a node (avatar + name + status, ringed in its own hue), and any live `spex watch` A→B is a
      directed arrow in A's hue. Screenshot the rendered graph and file it with
      `spex yatsu eval session-graph --image <png> --pass`.
    expected: >-
      The relationship graph renders inside the console's right pane: every live session shows as a
      node and any live monitor shows as a directed arrow between two nodes. The filed reading carries
      the screenshot as image evidence and a pass verdict.
  - name: node-gestures
    description: >-
      In the relationship graph, exercise the pointer gestures. (1) DOUBLE-click a session node — the
      console switches to that session's tab (single-clicking does NOT open it). (2) Single LEFT-click
      a node — it lights up as the picked watcher (dashed hue outline) and a toast prompts you to
      right-click the watched; then RIGHT-click a different node — an optimistic dashed monitor arrow
      appears from the first to the second with an "asked … to monitor …" toast, and no browser context
      menu pops up. A standing hint near the `?` advertises the click-then-right-click rule. Screenshot
      the picked-source + pending-edge state and file it with `spex yatsu eval session-graph --image <png> --pass`.
    expected: >-
      Double-click opens a session (single-click never does); a left-click picks a node as the watcher
      (visible highlight + toast) and a following right-click on another node draws the optimistic
      pending monitor arrow and dispatches the ask — with the native context menu suppressed. There are
      no connection handles on the nodes. The filed reading carries the screenshot and a pass verdict.
---
# yatsu.md — session-graph

This view is product surface — it is measured by **looking** (YATU), not by a unit test: the agent opens
the relationship tab through the running console and screenshots the live monitor web (session nodes +
directed `spex watch` arrows), filing it as a reading with image evidence and a verdict.
