---
title: session-multi-select
status: active
hue: 232
desc: Sessions rows support explicit multi-select and a shared close action.
code:
  - spec-dashboard/src/SessionForestPanel.jsx
related:
  - spec-dashboard/src/SessionSelectBar.jsx
  - spec-dashboard/src/SessionWindow.jsx
  - spec-dashboard/src/SessionContextMenu.jsx
  - spec-dashboard/test/session-multi-select.e2e.mjs
---
# session-multi-select

The routed Sessions page owns the complete session forest. A row's context menu can enter multi-select,
preselecting that row. While selecting, every visible session row is a checkbox-like toggle and clicking it
never navigates or changes the active terminal, and the row button reports that state as `aria-pressed`.

**The pick mark is the fold pod's own circle, never a second one.** While selecting, every visible row leads
with one ring in the fold column — the same slot and geometry the [[session-row]] pod occupies at rest. A
parent's ring keeps its subtree count and rollup colour, so the set being built still reads how much fleet
sits under each row; a leaf's ring is empty. Fill means picked here: a picked ring is blue, never the rollup
hue, with its count (or, on a leaf, a check) in paper. The pointer fold control steps aside for the ring's
duration, so the forest's shape is frozen while a set is being picked — a picked row cannot fold out of sight
under a collapsed parent — and cancel restores the resting pods. Keyboard disclosure on the active row
remains a console-level route. The selection bar is one non-wrapping row at the same 28px action
scale and spacing as the forest's header pills: its count owns the only shrinkable slot and truncates with an
ellipsis, while close-selected is a danger-coloured trash icon and cancel is an × icon. Both icon buttons keep
their localized tooltip and `aria-label`. Confirmation uses the same close endpoint as the single-row action and every
request is reconciled by the board reload; graph marquee selection is unrelated and must not satisfy this contract.

The same page owns row movement. A whole session row becomes a pointer drag after the shared six-pixel gesture
threshold. The live source row dims, an inert projection follows the pointer at 75% scale, and a valid receiving
row is highlighted. A nested row exposes a fixed top-level drop zone; self, descendant, and existing-parent
landings are no-ops. A valid landing calls the existing `/api/sessions/reparent` endpoint with one child and
the target parent (or `null` for top level), then opens the receiving parent and reloads the board. Escape,
unmount, invalid targets, and below-threshold clicks do not mutate state.
