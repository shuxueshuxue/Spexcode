---
title: work-pane
status: active
session: sess-merge
hue: 335
desc: The node popup — a reference view of intent; the live work surface moved to the session interface.
code:
  - spec-dashboard/src/NodeView.jsx
related:
  - spec-dashboard/src/IssueCard.jsx
---
# work-pane

## raw source

The spec and the terminal are one act split in two — the spec is the *intent*, the terminal is where you
*change it in place*. Originally they shared one pop-out `work` pane, two columns (spec left for reading,
terminal right for the work), so intent and the surface that changes it sat side by side in a fixed-size
panel that never grows to xterm's measured width.

## expanded spec

The node popup is the `i` surface: a fixed pop-out (`min(900px,90vw) × min(600px,84vh)`) with tabs, opened
over the board and dismissed with `Esc`. It is **reference-only** (`NodeView.jsx`) — no `work` pane, no
embedded terminal. The intent half is the **spec doc** — an information board. A **stat bar** carries the
node's at-a-glance signals, the same the tile speaks: derived **status**, **version**, the aggregate **yatsu
score** ([[yatsu-score-badge]]), and the **drift** count when a governed file outran the spec
([[source-of-truth]]) — so score and drift live in the popup now, not only on the tile. Below it the governed
files, then the body as a living current-state document (the two
labelled parts — raw source / expanded spec — when authored that way, else the flat body). Neither part is
an agent-authored *current state* — what's-done is read from the derived status, never narrated, because
agents hallucinate completion. The proof and
evolution of that intent live in the **history** tab.
An **issues** tab lists the unified issue work bound to this node — local and forge, open and closed alike,
with both counts on the tab face (the board's badge/card show only the open ones; see [[dashboard-issues]]);
the data already rides the board fold (`node.issues`), so the tab is a no-fetch group, silent when empty.
Each entry is the shared compact `IssueCard`, clamped inside the popup and routed to the internal Issues
page selection (`#/issues/<issue-id>`), not directly to the forge. A **long pane earns a
small sticky text filter** (substring, over id + concern) — short lists skip it, the affordance would be
chrome; the eval timeline mounts the same control ([[yatsu-eval-tab]]). An **edit** tab makes a
node's in-flight change reviewable from the board: it exists **only** while the node has a pending overlay,
and when it does it **leads** (first tab, editing-session count on its face), so a node mid-change — a
freshly-added ghost most of all, otherwise near-empty on spec/history — opens with its change front-and-
centre. It lazily fetches the unified diff of the node's spec.md in the editing worktree vs the fork point
(`/api/edit`), rendered with the history tab's diff view and **memoised** the same way — re-opening shows the
last diff at once, not a reload — but **revalidated** each open, since a pending change is live.

`panesFor(node)` is the single source of which tabs exist and their order — both the tab bar and App's
keyboard pane-nav read it, so number/Tab keys never cycle to a tab that isn't there. `panesFor` also
registers an **eval** pane (a fourth reference face), but that pane's component and data contract — it
rides `node.evals`, the board fold — belong to [[yatsu-eval-tab]], just as the issues tab's content is
[[dashboard-issues]]'; this node owns the popup shell and the spec/history/issues/edit panes, so the eval pane's
reframe into a verdict-over-evidence timeline is that node's evolution, never work-pane drift. The **history** tab is
the one merged version log: the latest version sits expanded with its proof, older ones start collapsed and
reveal one at a time on the **down gesture** once you've finished the open one — scrolling past its end, *or*
a `j`/`↓` keypress when there is nothing left to scroll (a short history with no scrollbar, or the bottom of
a long one). Tying reveal to the gesture, not to scroll movement alone, is what keeps a sub-page history from
dead-ending with older versions forever hidden (a header click also toggles by hand). An **expand-all**
control complements that reveal, never replaces it: collapsed rows aren't mounted, so find-in-page and
jump-to-an-old-version can't reach them without the one door that opens everything. The version log itself
fetches **when the history tab first shows** (lazy, like eval/edit — most popup opens never visit it) and
persists after, so returning to the tab stays instant. A version's proof is
the **spec.md line diff** it introduced, fetched lazily on expand — every version, memoised by hash (the
latest no longer shipped precomputed); a version with no recorded change says so plainly. That scaffold — scroll container,
latest-expanded reveal, click-toggle, and the per-row header-over-evidence shape — is **data-agnostic and
shared**: the eval pane ([[yatsu-eval-tab]]) rides the same component (version rows + diff here, reading rows
+ screenshot there).

The "change it in place" surface — the live terminal — relocated to the *session* that does the changing
(`Enter`; see [[session-console]] and [[term-input]]), keyed to a session rather than pinned to a node. The
panel sizes to **itself**, never to xterm's measured width (each pane scrolls its own content, no stray
horizontal scrollbar) — but that sizing lives in `styles.css`, the dashboard's shared stylesheet governed by
[[node-graph]]; this node owns only the
popup component, so a style change elsewhere is never drift here. So the original "one act split in two"
intent stands, but the union is dissolved: intent in the popup, the changing surface with the session.
