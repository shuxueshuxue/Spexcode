---
title: esc-layers
status: active
hue: 200
desc: One Escape contract — overlays peel topmost-first, a press never closes the surface behind the one in front.
code:
  - spec-dashboard/src/escStack.js
related:
  - spec-dashboard/src/ReviewProof.jsx
  - spec-dashboard/src/SessionContextMenu.jsx
  - spec-dashboard/src/SessionInterface.jsx
---

# esc-layers

## raw source

When overlays stack — a close-confirm over the open session panel, the proof report over the board —
**Escape must peel exactly the one in front**, then the next press the one behind it. The frustrating
failure is a single Esc skipping a layer: dismiss the confirm AND the panel it sat on in one keystroke, or
the proof closing the whole board behind it. A human reaches for Esc to undo the last thing that appeared,
nothing more. There should be **one** rule for this, not a different ad-hoc handler bolted onto each overlay.

## expanded spec

The contract is a **LIFO layer stack**. Any overlay that floats as its own component **above** another
surface registers itself as the top layer while open; a single Escape press **closes the topmost layer
only** and is **swallowed there**, so the surface beneath it never also closes on the same press. Close that
layer and the next press reaches the one below. This is the mechanism behind the layering other nodes
already promise in z-order terms — [[session-rename]]'s confirm that "renders above the board," the
[[review-proof]] overlay over the [[session-console]] panel.

Why a stack and not each overlay minding its own Esc: the overlays that broke were **separate components**
all listening on the window at once. With nothing arbitrating, the winner was decided by **registration
order** (the always-mounted panel listened first, so its Esc closed the panel before a later-mounted modal
could stop it) — papered over with `stopImmediatePropagation` races and, for the proof, by stealing iframe
focus so the parent never saw the key. One stack listener, bound **before any component** so it runs first,
replaces all of that: it consumes Esc when a layer is open and stays silent when none is.

**Scope is deliberately the cross-component overlays** — the proof, a row's rename and close-confirm modals,
the row context-menu. The board's own keys are **out of scope and unchanged**: the help/settings/search
modals and the locked-session release route through one already-coherent handler ([[keyboard-nav]]), and a
panel's internal sub-states (its completion menu, nav-mode's raw-key forwarding, the graph legend) order
their own Esc within that one panel. Those never raced, so they keep their single handler; because the stack
is silent when empty, they behave exactly as before. New overlays that float above another surface should
join the stack rather than add a fresh window listener — that is the whole point of having one.
