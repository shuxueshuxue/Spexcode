---
title: session-search
status: active
hue: 280
desc: From the sessions page, ⌘/Ctrl+/ opens the SAME search palette the graph page uses — sessions boosted to the top — and a pick either opens a session's tab or jumps to a node on the graph.
related:
  - spec-dashboard/src/SpecSearch.jsx
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/Dashboard.jsx
  - spec-dashboard/src/address.js
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/styles.css
---
# session-search

The [[session-console]] is where you live while driving agents — but the jump-to escape hatch was reachable only from the graph page behind it (the `/` palette, see [[keyboard-nav]]). This node gives the sessions page its own way in: **⌘+/ (and Ctrl+/) opens the SAME palette**, never a second one. It sits beside the console's other reserved chords (⌥/⌘+I, ⌥+N) as a fixed binding, not a page verb.

A chord alone is invisible, so the entry point is also **clickable**: the session list's top row carries a
**Search pill** beside `＋` New ([[session-console]] hosts the row) — a monochrome inline-SVG magnifier in the
dashboard's own glyph vocabulary, its tooltip teaching the ⌘+/ shortcut. The button fires the **same single
open path** the chord does (the one sessions-boosted palette open threaded down from the app), never a second
palette or a second search implementation; it is momentary — the palette floats above, no tab switch, no
pressed state.

**Deliberate reuse, not a fork.** The pop-out IS the one [[shared-ranker]] palette component — same open/close, same keyboard, same four-plane matcher. Exactly two things differ, and each is a single knob the caller turns:

- **Lead weight.** You searched *from the sessions page*, so **sessions lead**: the palette boosts the session plane to the front of its plane interleave, spec nodes and the rest below. (The graph page's plain `/` still leads with nodes.) This is one `boost` parameter that reorders which plane leads each interleave round — the scoring maths and the keep-every-plane-visible interleave are untouched, so a session always tops the list while nodes/issues/scenarios stay reachable below.
- **Select target.** A result selects the product surface that owns that kind of thing, through the shared
  [[address-routing]] vocabulary. Picking a **session** opens (or switches to) that session's
  tab. Picking a **spec node** routes to the graph page and focuses that node. Picking an **issue** routes to
  the Issues page's own detail address (`#/issues/<issue-id>`). Picking a **scenario** routes to the Evals
  page's own detail address (`#/evals/<node>/<scenario>`). The palette no longer collapses every non-session
  match back to the graph: issues and scenarios are first-class review objects, and their search hits land
  on their review surfaces.

**A modal owns the keys** — [[keyboard-nav]]'s standing contract, now realized over the sessions page too. While the palette is open it floats above the sessions page and owns every key; the session interface yields entirely (its own key router stands down) until the palette closes. That this reuse stayed clean — only a lead-order knob plus a shared select branch, no copied palette — is the whole point: a coupling that had forced a second palette would be a smell to fix at the shared component, never to route around.
