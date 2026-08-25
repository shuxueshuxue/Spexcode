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
never navigates or changes the active terminal. The selection bar is one non-wrapping row at the same 28px action
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
