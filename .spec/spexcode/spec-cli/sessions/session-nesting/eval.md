---
scenarios:
  - name: child-folds-under-its-spawner
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/session-tree-disclosure.e2e.mjs
    description: >
      Through the running dashboard in a real browser, drive the actual product: from one live session (call
      it PARENT), run `spex new "<a small task>"` in its terminal so the backend launches a CHILD from inside
      PARENT's process. Wait for the child to appear, then open the session console (Enter). Read the left
      session list. The child must NOT sit as its own top-level tab beside PARENT; instead PARENT's row shows the
      fold pod (a pill with the subtree count). Screenshot the collapsed list. Click PARENT's row body and
      confirm its surface-native selection/open action without changing the fold; then click PARENT's pod and
      screenshot again. Repeat the row-body-versus-pod check in the map-side SessionWindow and phone Sessions
      list at narrow browser widths.
      Finally, close PARENT (row right-click → Close) and force a board reload; screenshot the list once more.
    expected: |
      Collapsed: the child is HIDDEN — PARENT is one row leading with a FILLED fold pod whose number is the
      subtree count (1 here); the child is not a sibling top-level tab. PARENT's own status glyph and which
      triage zone it sits in (needs-you vs self-running) are PARENT's OWN — never an aggregate of the child.
      Clicking the row body never changes the fold; it only selects/opens/locks according to that list surface.
      Only the leading pod carries `aria-expanded`. After clicking the pod it turns OUTLINE (count unchanged)
      and the child row appears indented directly
      beneath PARENT (recursively — a child that itself spawned would carry its own pod). After PARENT is closed and the board reloads, the child AUTO-PROMOTES to a
      top-level row (its dangling parent pointer is dropped at read time) — no orphan is lost, no migration ran.
  - name: pod-click-keeps-current-surface-focus
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, with a PARENT session that has a child (so PARENT's row
      shows a fold pod), open the session console. First focus the live xterm, read `document.activeElement`,
      and click PARENT's fold pod. Then open Command Box, type a draft, read its focused textarea, and click the
      pod again. Record the interaction and activeElement readings.
    expected: |
      Clicking the fold pod toggles the fold but never moves focus: xterm's helper textarea remains active in
      the first pass and Command Box's textarea remains active with its draft undisturbed in the second. The pod
      never becomes the active element and focus never lands on its session-row-button ancestor.
  - name: primary-arrows-disclose-current-session
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/session-tree-disclosure.e2e.mjs
    description: >
      Through the running dashboard in a real browser, select a collapsed PARENT row in the session console
      while its CHILD is hidden. From the console surface press Alt+Shift+ArrowDown, then
      Alt+Shift+ArrowUp. Record the row's `aria-expanded` state and the CHILD row's visibility after each key,
      plus the selected session id. Repeat Alt+Shift+ArrowDown on a selected leaf while a real input/terminal
      owns focus and observe the key is consumed without moving to another session.
    expected: |
      Alt+Shift+ArrowDown expands the currently selected PARENT and Alt+Shift+ArrowUp collapses it through the
      same fold state as its leading count pod, without changing selection or session data. On a leaf the chord
      is consumed as a no-op, so it cannot move the tab selection. No second tree or persisted expansion state
      is introduced.
  - name: whole-row-drag-reparents-and-detaches
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/session-tree-disclosure.e2e.mjs
    code: [spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/styles.css, spec-dashboard/src/SessionContextMenu.jsx]
    related: [spec-dashboard/src/SessionWindow.jsx, spec-cli/src/session-reparent.ts]
    description: >-
      In the running desktop console, reveal one nested CHILD and an unrelated live TARGET. Pointer-drag the
      CHILD row with a title long enough to expose all three selected headline lines onto TARGET, then drag it
      into the revealed top-level drop zone. While the pointer owns the drag, record the source and ghost row
      element/state, visible headline line boxes, and right-side status-marker float. Repeat the top-level
      detach from the CHILD's right-click menu while intercepting the manager write, and record the target
      state and each request body.
    expected: >-
      Dragging starts only after motion and the original row dims while a fixed, full session-row ghost follows
      the pointer. A selected long-title source and its ghost have the same row element/state, the same three
      visible headline lines, and the same right-floated status marker: only the first line gives that marker
      space while later lines recover full width. A valid TARGET is visibly highlighted even beneath that ghost
      and receives exactly
      `{children:[CHILD], parent:TARGET}`. A nested child exposes a top-level drop zone that highlights on
      hover and sends exactly `{children:[CHILD], parent:null}`. The context menu offers `remove from parent`
      only for a nested row and sends that same null-parent write. Self, present-parent, and descendant targets
      do not become drops or writes.
  - name: triangle-colour-is-an-informational-rollup
    tags: [frontend-e2e, desktop]
    description: >
      With a PARENT session that has at least two children in DIFFERENT states (e.g. one working/parked and one
      that has proposed review or is asking), open the console and read PARENT's collapsed fold-pod
      colour, then expand and confirm each child's own status glyph. Compare the triangle hue to the child
      states and to PARENT's own zone placement.
    expected: |
      The pod COLOUR (its fill while collapsed, its outline/number once expanded) is a purely-informational
      subtree rollup in the STATUS_COLOR language: dark-yellow
      when ANY descendant needs attention (asking/review/done/close-pending, error folded into yellow), else
      green when every descendant is running/self-driving (working/parked), else neutral/grey (all idle/offline).
      Crucially the pod colour does NOT move PARENT between zones or change PARENT's own glyph or sort slot:
      a yellow pod over a parked PARENT still leaves PARENT in the self-running zone with its parked glyph —
      the downward rollup is a passive hint, never an escalation. Each child keeps its own true status glyph.
  - name: cli-child-scope-reads-the-durable-direct-parent
    description: >
      Drive `spex session ls --children` from a governed parent over a board containing direct children and an
      unrelated row, then repeat with `--children=<parent-id>` and a positional child filter.
    expected: >
      The CLI reads the stored direct parent field, not prompt prose: only direct children appear, each row
      exposes that parent, and the scope summary counts only displayed child states. The attached parent value
      does not consume the following positional selector.
    tags: [cli, backend-api]
    test:
      path: spec-cli/src/session-ls-cli.test.ts
      name: session ls projects parentage, a child scope, and status summary without stealing positional selectors
    code: [spec-cli/src/cli.ts, spec-cli/src/sessions.ts]
---

# session-nesting — yatsu

Measure through the **real dashboard surface**, YATU-style: spawn a real child by running `spex new` from
inside a live session's own terminal (never a hand-forged `parent` field or an internal helper), then read the
actual console session list in the browser. The loss is the spec's two contracts: a child **folds under its
spawner** (collapsed by default, the fold pod expands it, and it **auto-promotes** to top-level once
the parent is closed — derived at read time, no stored mutation); and the fold **never lies about the group** —
the parent row's glyph and zone are the parent's OWN, while the triangle colour is a purely-informational
subtree rollup that never changes the parent's zone or sort. Evidence is a collapsed/expanded/after-close
screenshot trio plus the pod-colour reading against the children's real states.
