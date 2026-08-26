---
title: eval-door
status: active
hue: 280
desc: The session document's Eval door — a real anchor to the canonical session-scoped Evals address, carrying a bounded four-tally glance over the row's `evalSummary` projection whose spinner only ever promises an arriving value.
code:
  - spec-dashboard/src/SessionInterface.jsx#SessionEvalStats
related:
  - spec-eval/src/sessioneval.ts
  - spec-dashboard/src/sessionEvalCoherence.test.mjs
  - spec-dashboard/test/session-toolbar.e2e.mjs
---

# eval-door

The [[session-console]] mounts no eval pane of its own: a session's evals ARE the Evals page read through the
`scope:<id>` token ([[session-eval]], [[evals-view]]). What the console keeps is one door in the frame's
document-action band, and this node owns everything that door says and never says.

The Eval door is a REAL anchor whose href is
the canonical session-scoped Evals list address (the scoped default query, minted by [[address-routing]];
copy-link/middle-click work for free), so clicking it (or the typed
`/eval`) is one ordinary hash push onto that list ([[session-eval]] /
[[evals-view]] — the one canonical home of a session's measured evaluation; the console mounts no
eval pane of its own, so the console width is stable and a warm pane is never reflowed;
see [[live-view]]). **It lives on the FRAME's AMBIENT LINE** ([[status-bar]]), registered by the session document as a fact about
itself, and not in a console-local tab rail — the console has no tab rail to hold it, and a door drawn inside
the pane would be a second toolbar competing with the one the frame already owns. It is not in the
document-action band either, and the difference is what each region answers: the band is a row of VERBS that
act on the document, while this is one persistent READOUT of how the document's measurement is doing, which
is the fact an ambient line exists to hold. It therefore takes the LINE's geometry — the `--line-status` row
height, no box of its own, the frame's `sb-item` owning the padding and the reader's hide gesture — and
widens only for the glance it carries.

**A mounted document is not the read document.** The workspace keeps recent documents mounted while hidden
([[workspace-shell]]'s pool), so registering on mount alone would leave a session's eval glance sitting on the
line while the reader is reading a spec — a readout claiming to be about a document nobody is looking at.
The door registers only while the console's own pane is the ACTIVE one, and the un-registration is the same
effect's disposal, so it leaves the line on the tab switch itself rather than one paint later. The door carries a compact, symbolic glance over that SAME worktree-rooted session model,
already bounded by [[session-eval]] to scenarios this worktree affected or measured. Its four mutually exclusive
scenario tallies are the complete visible accounting: reliable current pass/fail counts use [[review-chrome]]'s
`ReviewState` vocabulary, measured stale or legacy/unscored scenarios carry a visible clock tally as work still
needing review, and declared-but-unmeasured scenarios remain a visible blind-spot count. The door does NOT repeat
a measured/declared aggregate beside those categories: `fresh pass + fresh fail + needs review + blind = affected
declarations` already says the whole thing without a second number. Node-level unknown frontend coverage is a
separate missing-state tally, never part of the scenario accounting. The door's accessible name speaks this same
complete decomposition; the visible glance is never hidden from assistive technology. Loading, load failure, and zero are
distinct states — a transport failure is never painted as
zero loss. This is a glance and a door, never a scenario menu or an explanatory paragraph.
The glance is the selected graph session row's `evalSummary` projection; it performs no REST read and owns no
timer. Switching tabs or remounting therefore preserves the cached last-known value. An input event first shows
`updating` beside that last-known value, never zero; a stable equal-generation projection becomes current; a
compute failure stays explicit with last-known retained. A graph-stream disconnect similarly marks the value
last-known until an authoritative reconnect snapshot re-anchors it. `ready` with every category at zero is the
only empty state, distinct from loading, updating, disconnected, dormant, and error.

**A spinner is a promise that a value is arriving, so only an arriving state may spin.** The door spins for
`loading` and `updating` and for nothing else. A **dormant** projection ([[session-eval]]: a retained offline
session the backend deliberately does not precompute) and a selected row carrying no projection at all (a
closed session, which leaves the board and is served from the archive index instead) are the same fact — no
value is coming until someone asks for one — and the door says so: last-known counts when it has them, a
still blind-spot mark when it does not, and an accessible name naming the door itself as the way to measure
it. The door is already that anchor, so opening it is the whole repair; the console never fetches a summary
of its own to fill the gap.
