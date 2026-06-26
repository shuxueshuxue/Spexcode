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
---
# yatsu.md — session-graph

This view is product surface — it is measured by **looking** (YATU), not by a unit test: the agent opens
the relationship tab through the running console and screenshots the live monitor web (session nodes +
directed `spex watch` arrows), filing it as a reading with image evidence and a verdict.
