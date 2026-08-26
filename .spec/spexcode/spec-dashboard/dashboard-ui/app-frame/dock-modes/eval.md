---
scenarios:
  - name: rail-owns-dock-projection-cycle
    description: >-
      In the running desktop dashboard, click the rail's Explorer and Sessions projection buttons through
      the three states: explorer open, dock closed, and sessions open. Reload, then inspect the persisted
      projection and verify the dock has no modebar.
    expected: >-
      Explorer is initially pressed with the dock open; clicking it closes the dock and clears both pressed
      states; clicking Sessions reopens the dock in sessions mode and presses only Sessions. Reload preserves
      the open sessions projection. The dock begins directly with its EXPLORER count head or sessions list
      head, and `.dock-modebar` never renders. No document hash changes during the cycle.
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/SideBar.jsx, spec-dashboard/src/Dock.jsx, spec-dashboard/src/workspace.jsx]
  - name: sessions-dock-is-the-one-list
    description: >-
      Through the running desktop dashboard, open the sessions dock projection, inspect its real rendered
      forest rows and status glyphs, then click a session row and the `+` New Session door. Inspect the routed
      session document after each navigation, and open the bottom archive door.
    expected: >-
      The dock is the only desktop session list: rows follow the session forest hierarchy, show status glyphs,
      and highlight the route-selected session. A plain row click navigates in place and ctrl/command-click
      holds a tab. The `+` door reaches `#/sessions/new`; the archive door opens the existing document overlay.
      On `#/sessions/<id>` and `#/sessions/new`, the document contains no `.si-list`, `.si-board-scroll`, list
      resizer, or collapsed stub; the terminal or timeline fills the complete document width. No drag or
      multi-select affordance appears in the read-only dock.
    tags: [frontend-e2e, desktop]
    code:
      - spec-dashboard/src/Dock.jsx
      - spec-dashboard/src/SessionInterface.jsx
      - spec-dashboard/src/SessionsView.jsx
  - name: every-frame-sidebar-folds-on-the-one-movement
    tags: [frontend-e2e, desktop]
    description: >-
      For each of the frame's three foldable sidebars — the left dock, the Sessions document's forest, and
      the spec document's right context dock — toggle it in a real browser and sample FROM INSIDE THE PAGE
      across animation frames, since the fold is shorter than a driver round-trip. On opening read the early
      width and animation-name against the settled width; on closing read whether the element is still
      present carrying the closing class, and whether it is gone one duration later.
    expected: >-
      Opening runs `dock-in` and is measurably narrower early than settled; closing runs `dock-out` with the
      element still mounted and marked closing, then unmounted after one `--dur-panel`. All three run the
      same animation names and the same duration — three panels with their own timers is how a shared
      gesture drifts apart. At rest a closed panel is unmounted, so a closed dock still costs nothing, and
      the context dock carries its own inner scroller, because a folding panel must clip its width and
      clipping without a scroller makes a long list unreachable rather than scrollable.
    code: [spec-dashboard/src/useFold.js, spec-dashboard/src/styles.css]
  - name: the-band-hands-over-without-being-torn-down
    tags: [frontend-e2e, desktop]
    description: >-
      In a real browser, sample the left band per animation frame across a route switch from a Sessions
      document to a spec and back, reading the painted width of whichever component draws it. Measure the
      band's RIGHT EDGE, not a container: on Sessions the forest lives inside the content column and on Spec
      the dock sits outside it, so a container probe reports two different elements and invents a lurch the
      size of the whole band (measured — it claimed 204px of movement that was entirely its own confusion).
    expected: >-
      The band's width never dips across the switch: the same number before, during, and after, because the
      band did not leave — only the component drawing it changed hands. The one movement left is the small
      slide the dissolve is made of, an order of magnitude under the band's width. A run where the band
      collapses toward zero and grows back is the defect this scenario exists to catch: it is the fold
      animation, a width movement, being run for something that was never a fold.
    code: [spec-dashboard/src/useFold.js, spec-dashboard/src/dockBand.js, spec-dashboard/src/styles.css]
---

Measure through the running dashboard in a real desktop browser (YATU). Use settled screenshots for the dock
forest, New Session document, and archive overlay, plus DOM geometry as supporting evidence that the terminal or
timeline owns the full holding region. The dock is finding; session content remains holding, in line with the
workspace-shell four-region model.
