---
scenarios:
  - name: enter-activates-focused-control
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard on the spec node graph and put real keyboard focus on the HUD's `?` help
      button (Tab to it or focus it directly — `document.activeElement` must be the `.hud-help`
      button). Press `Enter`. Then, as the contrast, click the same button with the mouse. Screenshot
      the state after the Enter and file with
      `spex yatsu eval keyboard-nav --scenario enter-activates-focused-control --image <png>`.
    expected: >-
      Enter on the focused `?` button activates the button — the help/keymap legend opens, exactly as a
      mouse click does. A focused native control (button, link, form field) owns its activation keys:
      the board's key vocabulary steps aside, so Enter is the control's click here, NOT the board.info
      alias — the node-info popup must not open instead. Tabbing to a control and pressing Enter must
      always equal clicking it (keyboard reachability).
    code:
      - spec-dashboard/src/Dashboard.jsx
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
      focused node and the route stays on the graph. Enter no longer crosses to the Session Board from
      anywhere — not from the graph (it opens the info popup) and not from inside the popup either (see
      enter-in-info-popup-is-inert). Crossing into a node's live session is now a right-click node-menu
      action ([[node-menu]]), never a keystroke.
    code:
      - spec-dashboard/src/Dashboard.jsx
      - spec-dashboard/src/keymap.js
  - name: lens-follows-focus
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard, focus a node that has several siblings, and press `i` to open the node-info
      popup. With the popup OPEN, press `Shift+j`: focus moves to the next sibling AND the popup
      re-renders onto that sibling (its title/spec replace the old node's) — it does not close, and the
      board pans behind it. Press `Shift+j` again for the next sibling, `Shift+k` back, `Shift+h` to
      the parent. Then press a plain `j` (no modifier): the popup pane SCROLLS and focus does NOT move
      — unmodified keys keep their popup meanings. Record the whole run as a video (this is a
      multi-step interaction) and file with
      `spex yatsu eval keyboard-nav --scenario lens-follows-focus --video <webm> --pass`.
    expected: >-
      The node-info popup is a lens, not a modal: Shift+h/j/k/l (and Shift+arrows) perform the same
      relationship walk as the bare board while the popup is open, and the popup follows the focus —
      each Shift+j lands on the next sibling and the popup shows that node at once, so a run of sibling
      docs is read without ever closing it. Unmodified popup keys are untouched: plain j/k scroll the
      pane, h/l/Tab switch panes, Esc closes, Enter stays inert. Across a lens move the selected pane
      persists, falling back to the new node's own default pane when it lacks the selected one.
    code:
      - spec-dashboard/src/Dashboard.jsx
      - spec-dashboard/src/keymap.js
  - name: enter-in-info-popup-is-inert
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard on the spec node graph and press `i` (or Enter) to open the node-info popup —
      the "Information Board". With the popup OPEN, press `Enter`. Nothing happens: the popup stays open
      and the route stays on the graph (`#/`); it does NOT navigate to the Session Board (`#/sessions`).
      Screenshot the still-open popup after the Enter and file with
      `spex yatsu eval keyboard-nav --scenario enter-in-info-popup-is-inert --image <png> --pass`.
    expected: >-
      Inside the open node-info popup, Enter is inert — it is a pure reading surface with no Enter verb,
      so pressing Enter does nothing: the popup does not close and the route does not leave the graph.
      Enter no longer crosses from the popup into the node's live Session Board; that crossing moved to
      the right-click node-menu ([[node-menu]]).
    code:
      - spec-dashboard/src/Dashboard.jsx
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
      - spec-dashboard/src/Dashboard.jsx
  - name: slash-search-spans-four-planes
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard, press `/` to open the search palette, and type a fragment that matches across
      planes (e.g. "renders"). The results list rows each tagged by plane — node / session / issue /
      scenario — with a coloured dot and the path/context. Screenshot the palette showing the scenario rows and file with
      `spex yatsu eval keyboard-nav --image <png> --pass`.
    expected: >-
      The `/` palette returns matches across all FOUR planes (spec nodes, sessions, issues, scenarios),
      each row tagged with its plane; scenario rows read SCENARIO and carry their node path. Selecting those
      review rows routes through [[address-routing]], which owns the round-trip proof.
    code:
      - spec-dashboard/src/SpecSearch.jsx
  - name: slash-search-reaches-node-prose
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard, press `/`, and type a distinctive word that lives ONLY in some node's spec
      prose — not in any title, id, or path (e.g. "hatch", which sits in keyboard-nav's own body
      "Slash-to-search is the escape hatch"). The node whose body holds the word appears in the results
      tagged NODE, even though its name/path don't contain the query.
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
  - name: modified-browser-shortcuts-pass-through
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard on the graph page and attach a capture-phase keydown probe after the app has
      mounted. Press modified browser/system shortcut chords whose base keys are graph bindings:
      Ctrl/⌘+L (`l` is child nav), Ctrl/⌘+, (`,` is settings), Alt+Left (left is parent nav), and
      Ctrl/⌘+0 (`0` is zoom reset). Record whether those events arrive at the probe with
      `defaultPrevented === false` and the graph route / focused node / visible overlays unchanged.
      Then press the intentional modified app shortcut Ctrl/⌘+/ and confirm it opens the search palette.
    expected: >-
      Modified browser/system shortcuts pass through the graph handler: they are not prevented, do not
      move focus, do not open graph overlays, and do not navigate the dashboard. The only modified
      shortcuts the graph claims are the explicit app accelerators: Ctrl/⌘+/ for session-boosted search
      and the Alt page jumps.
    code:
      - spec-dashboard/src/Dashboard.jsx
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
shared momentum scroller (`scroll.js`). The modified-shortcuts scenario probes the real browser event
stream after the app's capture handler has run: base keys that are graph bindings must remain browser
shortcuts when Ctrl/⌘/Alt modifies them, while the deliberately declared modified app shortcut still
opens search. The **lens-follows-focus** scenario is dynamic — a multi-step keyboard interaction whose
point is the popup *changing* as focus walks — so its evidence is a **video** of the run, not a still.
