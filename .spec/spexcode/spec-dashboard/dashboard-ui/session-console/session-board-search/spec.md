---
title: session-board-search
status: active
hue: 280
desc: From the session board, ⌘/Ctrl+/ opens the SAME search palette the node graph uses — sessions boosted to the top — and a pick either opens a session's tab or closes the board and jumps to a node on the graph.
related:
  - spec-dashboard/src/SpecSearch.jsx
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/styles.css
---
# session-board-search

The [[session-console]] is where you live while driving agents — but the jump-to escape hatch was reachable only from the board behind it (the `/` palette, see [[keyboard-nav]]). This node gives the session board its own way in: **⌘+/ (and Ctrl+/) opens the SAME palette**, never a second one. It sits beside the console's other reserved chords (⌥/⌘+I, ⌥+N) as a fixed binding, not a board verb.

**Deliberate reuse, not a fork.** The pop-out IS the one [[shared-ranker]] palette component — same open/close, same keyboard, same four-plane matcher. Exactly two things differ, and each is a single knob the caller turns:

- **Lead weight.** You searched *from the session board*, so **sessions lead**: the palette boosts the session plane to the front of its plane interleave, spec nodes and the rest below. (The board's plain `/` still leads with nodes.) This is one `boost` parameter that reorders which plane leads each interleave round — the scoring maths and the keep-every-plane-visible interleave are untouched, so a session always tops the list while nodes/issues/scenarios stay reachable below.
- **Select target.** Picking a **session** opens (or switches to) that session's tab, exactly as the board does. Picking a **non-session** — a spec node, issue, or scenario — **closes the session view** and jumps focus to that node on the graph. This is ONE routing shared by both entry points: closing the session view is a no-op when you were already on the board, so the board's `/` needs no special case.

**A modal owns the keys** — [[keyboard-nav]]'s standing contract, now realized over the session board too. While the palette is open it floats above the session board and owns every key; the session interface yields entirely (its own key router stands down) until the palette closes. That this reuse stayed clean — only a lead-order knob plus a shared select branch, no copied palette — is the whole point: a coupling that had forced a second palette would be a smell to fix at the shared component, never to route around.
