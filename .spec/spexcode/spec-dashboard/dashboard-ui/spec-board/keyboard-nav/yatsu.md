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
  - name: slash-search-reaches-node-prose
    description: >-
      Open the dashboard, press `/`, and type a distinctive word that lives ONLY in some node's spec
      prose — not in any title, id, or path (e.g. "hatch", which sits in keyboard-nav's own body
      "Slash-to-search is the escape hatch"). The node whose body holds the word appears in the results
      tagged NODE, even though its name/path don't contain the query; picking it focuses that node.
      Screenshot the palette showing the prose-only match and file with
      `spex yatsu eval keyboard-nav --image <png> --pass`.
    expected: >-
      A query that matches only a node's spec prose (desc/body) — not its title, id, or path — still
      surfaces that node in the `/` palette, at the lowest weight (below any name/id hit), so search
      reaches the spec itself rather than just its name.
    code:
      - spec-dashboard/src/SpecSearch.jsx
---
# yatsu.md — keyboard-nav

Product surface, measured by **looking** (YATU): the agent opens the `/` palette and screenshots it —
once returning rows across all four planes, once surfacing a node by a word found only in its spec prose
(the body-reaching match is the latest behaviour) — filing each with image evidence and a verdict. Both
scenarios scope their freshness `code:` to the search palette (`SpecSearch.jsx`) — not the whole keyboard
shell (`App.jsx`) — so unrelated keyboard-nav edits don't stale these readings.
