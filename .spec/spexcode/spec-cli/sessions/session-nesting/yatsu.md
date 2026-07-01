---
scenarios:
  - name: child-folds-under-its-spawner
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, drive the actual product: from one live session (call
      it PARENT), run `spex new "<a small task>"` in its terminal so the backend launches a CHILD from inside
      PARENT's process. Wait for the child to appear, then open the session console (Enter). Read the left
      session list. The child must NOT sit as its own top-level tab beside PARENT; instead PARENT's row shows a
      small disclosure triangle. Screenshot the collapsed list. Click PARENT's triangle. Screenshot again.
      Finally, close PARENT (row right-click → Close) and force a board reload; screenshot the list once more.
    expected: |
      Collapsed: the child is HIDDEN — PARENT is one row carrying a disclosure triangle (▸); the child is not a
      sibling top-level tab. PARENT's own status glyph and which triage zone it sits in (needs-you vs
      self-running) are PARENT's OWN — never an aggregate of the child. After clicking the triangle it flips to
      ▾ and the child row appears indented directly beneath PARENT (recursively — a child that itself spawned
      would carry its own triangle). After PARENT is closed and the board reloads, the child AUTO-PROMOTES to a
      top-level row (its dangling parent pointer is dropped at read time) — no orphan is lost, no migration ran.
  - name: triangle-colour-is-an-informational-rollup
    tags: [frontend-e2e, desktop]
    description: >
      With a PARENT session that has at least two children in DIFFERENT states (e.g. one working/parked and one
      that has proposed review or is asking), open the console and read PARENT's collapsed disclosure triangle
      colour, then expand and confirm each child's own status glyph. Compare the triangle hue to the child
      states and to PARENT's own zone placement.
    expected: |
      The triangle COLOUR is a purely-informational subtree rollup in the STATUS_COLOR language: dark-yellow
      when ANY descendant needs attention (asking/review/done/close-pending, error folded into yellow), else
      green when every descendant is running/self-driving (working/parked), else neutral/grey (all idle/offline).
      Crucially the triangle colour does NOT move PARENT between zones or change PARENT's own glyph or sort slot:
      a yellow triangle over a parked PARENT still leaves PARENT in the self-running zone with its parked glyph —
      the downward rollup is a passive hint, never an escalation. Each child keeps its own true status glyph.
---

# session-nesting — yatsu

Measure through the **real dashboard surface**, YATU-style: spawn a real child by running `spex new` from
inside a live session's own terminal (never a hand-forged `parent` field or an internal helper), then read the
actual console session list in the browser. The loss is the spec's two contracts: a child **folds under its
spawner** (collapsed by default, a disclosure triangle expands it, and it **auto-promotes** to top-level once
the parent is closed — derived at read time, no stored mutation); and the fold **never lies about the group** —
the parent row's glyph and zone are the parent's OWN, while the triangle colour is a purely-informational
subtree rollup that never changes the parent's zone or sort. Evidence is a collapsed/expanded/after-close
screenshot trio plus the triangle-colour reading against the children's real states.
