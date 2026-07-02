---
title: review-surface
status: pending
hue: 250
desc: The review overlay — one button/one key opens the project's measured loss for human review, evals leading and open concerns pinned below; one FeedSection component at three densities.
related:
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/keymap.js
  - spec-dashboard/src/escStack.js
---
# review-surface

## raw source

Human review needs one surface: see the freshest measurements first (video evidence leading), never lose
sight of open concerns, and drill straight into annotation. Reachable two ways — a floating board button
(same chrome as the help button, beside it) and a rebindable verb in the keymap registry
([[keyboard-nav]]) — so it is one glance away by mouse or key. Evals outrank issues here: importance is
expressed as position and area, not as tabs that hide each other.

## expanded spec

**The outer container never scrolls.** The overlay is two fixed regions — the [[evals-feed]] above (the
larger share), the concerns list below — each scrolling internally, so the lower region stays on screen no
matter how long the upper one grows. Reachability comes from pinning, not from stacking order.

Both regions are the **same FeedSection component at three densities**: `bar` (a one-line summary with a
count — the region's floor: it collapses to this, never to nothing) ⇄ `region` (fixed height, internal
scroll) ⇄ `page` (full surface). Density is the **container's** prop; the component owns only rows,
virtual scrolling, filters, and row actions — and the **instance persists across density switches**, so
scroll position, focused row, and filter state survive expanding to a page and peeling back. A `page` is
one [[esc-layers]] layer: Esc peels to the two-region home, a second Esc closes the overlay.

Keyboard, per the modal-owns-the-keys rule: Tab jumps regions, j/k (or arrows) walk rows in the focused
region, Enter opens a row (an eval → the [[annotator]]; a concern → its thread), Enter on a `bar` expands
it. The seam: the concerns region is a read-only projection of the unified Issue port head (local
proposals + forge issues — the proposal line's nodes own that engine); this node owns the surface, the
FeedSection, and the evals side.
