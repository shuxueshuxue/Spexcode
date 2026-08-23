---
title: transient-notices
status: active
hue: 215
desc: The dashboard's one transient-feedback surface — a theme-native, accessible result stack with a default expiry, so a completed action acknowledges without permanently spending page geometry.
code:
  - spec-dashboard/src/TransientNotice.jsx#TransientNoticeProvider
  - spec-dashboard/src/TransientNotice.jsx#TransientNoticeViewport
related:
  - spec-dashboard/src/noticeTiming.js
  - spec-dashboard/src/transientNotice.test.mjs
  - spec-dashboard/src/Root.jsx
  - spec-dashboard/src/EvalsPage.jsx
  - spec-dashboard/src/IssuesPage.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/test/command-box-new.e2e.mjs
---
# transient-notices

A write that has already completed needs an acknowledgement, not a new resident panel. Before this node,
the Evals and Issues pages each carried a six-second, in-flow message while the session console pinned action
outcomes beside or over its controls, sometimes indefinitely. The same product fact then had three visual
grammars, and an old failure could keep consuming the active workspace long after it had been read.

One `TransientNoticeProvider`, mounted at the dashboard root, owns that lifecycle. Any dashboard surface
uses its `useTransientNotice()` hook to publish a short message and semantic tone (`success`, `error`, or
`info`); it does not own a timer, viewport, or duplicate rendering component. An ordinary notice gets one
derived expiry at publication: **3.2 seconds plus 70 ms per message code point, clamped from 5 to 14
seconds**. That gives concise acknowledgements the familiar five seconds while giving a long result enough
reading time. The derived value is the one source for both the dismissal timer and the progress rule. A caller
may explicitly opt into another duration or a persistent notice only when the product contract needs it;
silence never means permanent. A notice has a close control, pauses its remaining lifetime while hovered or
keyboard-focused, and resumes only after both have left, so readable copy is not removed while a human is
interacting with it. A close or expiry removes only that notice; separate actions remain a compact newest-last
stack rather than overwriting one another.

The viewport is fixed to the dashboard's **top-right** edge, above page content and below modal/popup layers. Its calm,
single-row Obsidian-like grammar is the existing palette: a small semantic icon, concise text, and a familiar
close icon in a lightly raised, theme-native surface. The first notice occupies the stable top edge; later
notices grow the sequence downward with a tight, consistent gap and matching width. The stack is bounded to half
the viewport height for bursts, scrolls when necessary, and pins new feedback into view instead of covering the
whole working surface. Notices with an expiry also show a two-pixel semantic-color progress rule along their
bottom edge; it is the visual lifecycle cue only, with no remaining-time label. The rule pauses and resumes with
the notice timer while hovered or keyboard-focused, and is omitted for persistent notices. It uses dashboard CSS
variables only, including the existing unified type scale; a theme flip reskins it without component logic. On
narrow screens it respects the safe top and right edges, uses the available width, and remains in the top half
rather than covering a thumb-reachable navigation control.

This is a completion/failure surface, not a substitute for state. A control that is actively posting keeps
its local disabled/busy state, and a form error that a person must repair stays next to that form. Once an
operation settles, its compact acknowledgement belongs here. The stack is `role=status` for ordinary and
successful feedback; an error is announced with `role=alert`. New messages therefore surface to assistive
technology without moving keyboard focus or interrupting the current task.

Some acknowledgements are also doors into an already-existing document. A caller may provide a click action; the
notice then exposes the same action to pointer and Enter/Space keyboard activation while its close button remains
independent. This is still the one transient-notice channel: the provider owns the interaction and lifecycle, and
the caller only supplies the destination action.
