---
scenarios:
  - name: slash-search-spans-four-planes
    description: >-
      Open the dashboard, press `/` to open the search palette, and type a fragment that matches across
      planes (e.g. "renders"). The results list rows each tagged by plane — node / session / issue /
      scenario — with a coloured dot and the path/context; picking a node, issue, or scenario focuses its
      host node, a session jumps to its tab. Screenshot the palette showing the scenario rows and file with
      `spex yatsu eval keyboard-nav --image <png> --pass`.
    expected: >-
      The `/` palette returns matches across all FOUR planes (spec nodes, sessions, issues, scenarios),
      each row tagged with its plane; scenario rows read SCENARIO and carry their node path; picking a
      scenario focuses its host node.
    code:
      - spec-dashboard/src/SpecSearch.jsx
---
# yatsu.md — keyboard-nav

Product surface, measured by **looking** (YATU): the agent opens the `/` palette and screenshots it
returning rows across all four planes (the scenario plane is the latest), filing it with image evidence and
a verdict. The scenario scopes its freshness `code:` to the search palette (`SpecSearch.jsx`) — not the whole
keyboard shell (`App.jsx`) — so unrelated keyboard-nav edits don't stale this reading.
