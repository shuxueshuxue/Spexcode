---
scenarios:
  - name: enter-opens-info-not-session-board
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard on the spec node graph (no popup open). Press `Enter` with a node focused.
      The node-info popup opens over the graph — exactly as pressing `i` does — and the page stays on
      the graph route (`#/`); it does NOT navigate to the Session Board (`#/sessions`). Screenshot the
      board with the info popup open and file with
      `spex yatsu eval keyboard-nav --scenario enter-opens-info-not-session-board --image <png> --pass`.
    expected: >-
      From the graph, Enter is a plain alias for the info key `i`: it opens the node-info popup on the
      focused node and the route stays on the graph. Enter no longer crosses to the Session Board — that
      crossing is now only the popup's own Enter, once the popup is open.
    code:
      - spec-dashboard/src/App.jsx
      - spec-dashboard/src/keymap.js
  - name: click-does-not-pan-keyboard-does
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard and read the React Flow viewport transform (the `.react-flow__viewport`
      translate). CLICK a node other than the focused one: it becomes focused and drills open, but the
      viewport transform is UNCHANGED — the board does not pan. Then press an arrow key (or h/j/k/l) to
      move focus by one step: now the viewport transform DOES change, flat-panning to recentre the new
      focus. Screenshot the board after the click (still framed as before) and file with
      `spex yatsu eval keyboard-nav --image <png> --pass`.
    expected: >-
      A mouse click re-focuses and expands the clicked node but the camera stays put (viewport transform
      unchanged) — nothing already on screen moves, because node positions are a fixed structural
      embedding. A keyboard focus move (arrow/vim) DOES pan the camera to recentre the new focus. The
      camera follows the keyboard, not the mouse.
    code:
      - spec-dashboard/src/App.jsx
  - name: slash-search-spans-four-planes
    tags: [frontend-e2e, desktop]
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
    tags: [frontend-e2e, desktop]
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
  - name: manual-scroll-wins-over-keyboard-glide
    tags: [frontend-e2e, desktop]
    description: >-
      Open a long scrollable surface (the help/keymap modal or a node-info popup with overflow). Press
      `J` (or down) a few times to start the momentum glide scrolling the body downward, then — while the
      glide is still easing (within ~0.5s of the last keypress) — immediately scroll the mouse wheel the
      other way. Screenshot the surface right after the wheel scroll and file with
      `spex yatsu eval keyboard-nav --image <png> --pass`. The view must rest where the wheel left it, not
      snap back to the keyboard-reached position.
    expected: >-
      A mouse-wheel (or trackpad/drag) scroll during an in-flight keyboard glide cancels the glide and
      keeps the wheel position — the view does NOT snap back to the last J/K-reached spot. Held/repeated
      J/K still stack into one glide, and switching to a different scrollable surface still drops the
      stale target.
    code:
      - spec-dashboard/src/scroll.js
  - name: palette-fits-screen-and-truncates-rows
    tags: [frontend-e2e, desktop]
    description: >-
      Open the `/` palette on a LARGE screen and type a query whose rows have long titles/paths (e.g.
      "session"). The panel is sized to the viewport (≈half-width, capped), markedly wider than a fixed
      560px. Then narrow the window (or test a smaller viewport) so rows would overflow: each row
      ELLIPSIS-truncates its title/path instead of widening the panel, and there is NO horizontal
      scrollbar along the bottom of the results. Screenshot the narrowed palette showing truncated rows
      and file with `spex yatsu eval keyboard-nav --image <png> --pass`.
    expected: >-
      The palette width scales with the viewport (adaptive, not a fixed 560px) and caps on a very large
      screen so lines stay scannable. A row too long for the panel truncates its title and path with an
      ellipsis (…); the results never produce a horizontal scrollbar. Tag chips and the plane tag stay
      intact, never squeezed out.
    code:
      - spec-dashboard/src/styles.css
      - spec-dashboard/src/SpecSearch.jsx
---
# yatsu.md — keyboard-nav

Product surface, measured by **looking** (YATU): the agent opens the `/` palette and screenshots it —
once returning rows across all four planes, once surfacing a node by a word found only in its spec prose
(the body-reaching match is the latest behaviour) — filing each with image evidence and a verdict. Both
search scenarios scope their freshness `code:` to the search palette (`SpecSearch.jsx`) — not the whole
keyboard shell (`App.jsx`) — so unrelated keyboard-nav edits don't stale these readings. The
**manual-scroll-wins** scenario is looked at the same way — start a J/K glide on a scrollable surface,
wheel against it mid-flight, screenshot that the wheel position holds — and scopes its freshness to the
shared momentum scroller (`scroll.js`).
