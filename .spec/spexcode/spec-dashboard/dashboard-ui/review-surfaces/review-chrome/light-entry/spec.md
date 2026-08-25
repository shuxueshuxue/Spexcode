---
title: light-entry
hue: 200
desc: The dashboard's root — frame-wide providers, the backend-health frame, and ONE resident App runtime for every address, review routes included.
code:
  - spec-dashboard/src/Root.jsx#Root
related:
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/EvalsPage.jsx
  - spec-dashboard/src/IssuesPage.jsx
  - spec-dashboard/src/MobileApp.jsx
  - spec-dashboard/src/route.js
  - spec-dashboard/src/reviewWorkspaceContract.test.mjs
---

# light-entry

The root is where the frame-wide providers are mounted, so every face — the board, the phone, the sealed
public graph — is inside them without asking which face it is. [[status-bar]]'s registry is one of these: a
contributor anywhere below can register an item without knowing which face is showing, and the hook is inert
outside a provider, so the sealed public build pays nothing for it. [[transient-notices]] is another: a
surface can acknowledge its own completed write through the provider alone. The same root wraps every face in
the shared backend-health frame, so an unreachable backend shows one global retry banner before any runtime is
asked to boot.

**There is one runtime.** Every address — a canonical `#/evals` or `#/evals/<node>/<scenario>` link, its
legacy session-scoped spelling, `#/issues`, a session, a node — mounts the same resident App, and review
routes are ordinary resident workspace documents inside it ([[workspace-shell]], [[view-registry]]). The root
no longer selects a lighter surface for a cold review URL: that fast path gave review routes a second host to
drift in and made the tab strip vanish on cold review navigation, so it was withdrawn in favour of one host
with one chrome. A legacy Evals address still normalizes to the canonical route and still mounts the SAME
[[evals-view]] components; there is no second renderer, data projection, or URL vocabulary.

The static [[public-spec-graph]] face is a compile-time exception: with `VITE_PUBLIC_GRAPH_ONLY=1`, the root
hands even a copied review URL to the sealed App, which normalizes the hash to `#/graph`. The live dashboard
keeps the one-runtime rule above.
