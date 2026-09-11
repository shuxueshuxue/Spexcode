---
title: segmented-control
status: active
hue: 215
desc: The one segmented control — a trough of segments with the chosen one lifted, for any choice among a few values, and the same segment standing alone for one on/off setting.
code:
  - spec-dashboard/src/Segmented.jsx
related:
  - spec-dashboard/src/Settings.jsx
  - spec-dashboard/src/DiffDocument.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/sessionSurface.test.mjs
---
# segmented-control

A choice among a few values — an interface language, a default console surface, a diff layout — is drawn
one way everywhere: one trough holding every option as a segment, the chosen segment lifted onto paper in
the medium weight, the rest in quiet ink that brightens under the pointer. The group is a `role="group"`
named by the setting it controls, and each segment is a real button whose `aria-pressed` says whether it is
the chosen one, so the keyboard and a screen reader reach the state the eye sees.

It was the Settings page's own control until the diff document needed the same choice for split or unified
and drew a second one beside it: bordered, blue-washed, a different height. That second copy is the defect
this node exists to prevent, so [[settings]] and [[diff-document]] mount the one `Segmented`.

A single on/off setting (the diff's line wrapping) is the same segment standing alone in its own trough,
lifted while on, rather than a checkbox or a third toggle style.

The control owns the grammar, not the density. A host in a compact toolbar shrinks the segment's height and
type from its own container and never passes a size into the control. Which options exist, and what
choosing one does, stay with the host.
