---
scenarios:
  - name: routed-spec-context-is-real
    description: A routed spec document's CONTEXT dock shows exactly two sections — the node's scenario states and its open issues — and no Backlinks panel anywhere; each row opens its own detail document.
    expected: Playwright opens a node with both projections, captures a settled screenshot showing Scenarios and Issues and no backlinks heading, and clicking a scenario row and an issue row changes the hash to #/evals/<node>/<scenario> and #/issues/<id> respectively.
    tags: [frontend-e2e, desktop]
  - name: both-dock-switches-speak-the-panel-vocabulary
    tags: [frontend-e2e, desktop]
    description: >-
      On a real `#/spec/<id>` page, read the rendered SVG of the rail's dock switch and of the document's
      context-dock switch, plus the latter's aria-pressed, with the right dock both closed and open.
    expected: >-
      The context switch draws the shared `panel-right` glyph and never the `list-checks` mark, in both
      states — the glyph names the dock this control owns rather than reporting that dock's state, because
      the mirrored pair has no empty-frame member and the alternative is drawing a panel on the region the
      control does not own to mean "closed". State is carried by aria-pressed and the active tint instead.
      Zero loss = one panel vocabulary across both dock switches with neither impersonating the other.
    code: [spec-dashboard/src/Shell.jsx, spec-dashboard/src/icons.jsx]
---
