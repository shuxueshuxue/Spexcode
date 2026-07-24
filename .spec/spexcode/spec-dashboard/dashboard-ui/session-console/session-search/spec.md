---
title: session-search
status: active
hue: 280
desc: Global ⌥+/ opens the shared palette with sessions first; the graph's plain / keeps nodes first.
related:
  - spec-dashboard/src/SpecSearch.jsx
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/Dashboard.jsx
  - spec-dashboard/src/address.js
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/styles.css
---
# session-search

The [[session-console]] is where you live while driving agents — but the jump-to escape hatch was reachable only from the graph page behind it (the `/` palette, see [[keyboard-nav]]). This node gives the sessions page its own way in without inventing another component. The entry matrix is deliberate: **plain `/` on the spec-node graph opens the shared palette with nodes first; global `⌥+/` opens that SAME palette with sessions first from every page, including the graph**. The Sessions Search pill is the click twin of the latter. `⌥+/` sits beside the console's other reserved Option chords (`⌥+I`, `⌥+N`) as a fixed binding, not a page verb. Command/Ctrl shortcuts remain available to the browser and native controls.

A chord alone is invisible, so the entry point is also **clickable**: the session list's top row carries a
**Search pill** beside `＋` New ([[session-console]] hosts the row) — a monochrome inline-SVG magnifier in the
dashboard's own glyph vocabulary, its tooltip teaching the ⌥+/ shortcut. The button fires the **same single
open path** the chord does (the one sessions-boosted palette open threaded down from the app), never a second
palette or a second search implementation; it is momentary — the palette floats above, no tab switch, no
pressed state.

**Deliberate reuse, not a fork.** The pop-out IS the one [[shared-ranker]] palette component — same open/close, same keyboard, same four-plane matcher. Exactly three things differ, each supplied by the caller or inherited from an existing source order:

- **Lead weight.** You chose the session-search entry (`⌥+/` anywhere, or the Sessions Search pill), so **sessions lead**: the palette boosts the session plane to the front of its plane interleave, spec nodes and the rest below. The graph page's plain `/` chooses the node-search entry and still leads with nodes. This is one `boost` parameter that reorders which plane leads each interleave round — the scoring maths and the keep-every-plane-visible interleave are untouched, so every plane stays reachable below its chosen lead.
- **Empty-query order.** Before a query exists there is no relevance score to invent. Each plane therefore
  keeps its source surface's stable order. The session plane feeds the palette the SAME fully disclosed
  [[session-nesting]] forest the dashboard list renders: triage zones in dashboard order, newest roots first
  within a zone, and each parent immediately followed by its recursively ordered descendants. The palette
  does not restate those rules or sort session names; it inherits them from the shared forest, so a future
  dashboard ordering change reaches the empty ⌥+/ list without a search-specific repair.
- **Select target.** A result selects the product surface that owns that kind of thing, through the shared
  [[address-routing]] vocabulary. Picking a **session** opens (or switches to) that session's
  tab. Picking a **spec node** routes to the graph page and focuses that node. Picking an **issue** routes to
  the Issues page's own detail address (`#/issues/<issue-id>`). Picking a **scenario** routes to the Evals
  page's own detail address (`#/evals/<node>/<scenario>`). The palette no longer collapses every non-session
  match back to the graph: issues and scenarios are first-class review objects, and their search hits land
  on their review surfaces.

**A modal owns the keys** — [[keyboard-nav]]'s standing contract, now realized over the sessions page too. While the palette is open it floats above the sessions page and owns every key; the session interface yields entirely (its own key router stands down) until the palette closes. That this reuse stayed clean — only a lead-order knob plus a shared select branch, no copied palette — is the whole point: a coupling that had forced a second palette would be a smell to fix at the shared component, never to route around.
