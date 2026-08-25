---
scenarios:
  - name: zones-fold-and-the-keyboard-walk-never-steals-a-sink
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/SessionForestPanel.jsx]
    description: >
      With sessions in every zone, fold and unfold the offline and archive zones from their headers, deep-link to a
      session inside a folded zone, then press ↑/↓ from inert chrome, from inside xterm, and from a textarea, and
      ⌥+↑/↓ from inside xterm; drag a working row onto the archive heading.
    expected: >
      The whole header is the one disclosure button; needs-you and running never fold; the deep-linked row stays
      revealed; plain arrows walk the list only from inert chrome while ⌥-arrows switch from anywhere and
      textareas keep their native keys; the drop performs the reversible close with no confirm.
---
# measuring session-forest

The list's contract is what it does with rows, so the measurement drives folds, keys, and the archive drop.
