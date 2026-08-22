---
title: status-bar
status: active
hue: 210
desc: One strip along the bottom and a registry behind it — items are declared data, not widgets someone positions.
code:
  - spec-dashboard/src/StatusBar.jsx
related:
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/GraphView.jsx
  - spec-dashboard/src/Root.jsx
  - spec-dashboard/src/GraphStats.jsx
  - spec-dashboard/src/PublicGraphAbout.jsx
  - spec-dashboard/src/styles.css
---
# status-bar

A full-width strip along the bottom of the frame, and — the part that matters — a **registry** rather than
a place to hang things.

**What it replaced.** Every persistent readout used to be its own absolutely-positioned block: the project
HUD in one corner, the tally strip in another, the public-graph disclosure in a third, each with its own
offsets and its own rung on the z-index ladder. Worse, they had to know about each other — the session
window capped its height at `calc(100vh - 112px)` because a tally strip happened to sit underneath it, a
number that encoded one widget's geometry inside an unrelated component. That is the coupling a registry
removes: a contributor declares an item and never learns where the bar is, and the bar reserves its own
height once, for everyone.

**The model.** Four independent implementations agree on it, so it is taken whole rather than invented:

- **Two ordered arrays, never one flow.** The left group carries workspace state; the right carries the
  focused document's. The right group renders **outward-in**, so an appended item lands at the outer edge
  and a higher priority sits nearer the centre without the contributor computing a position.
- **An item is data plus a lifetime, never a DOM node handed in.** It declares `id`, `side`, `priority`,
  a `text` or `node`, an optional `tooltip`/`onClick`, and a `kind`. **`kind` is the only colour a
  contributor may spend** — there is no raw-hex field, because a pinned hex cannot re-theme, which is
  exactly the mistake the node status dots made and the one thing a new item must not be able to repeat.
- **Order is a number with a deterministic tiebreak.** Higher priority moves an item left within its group;
  ties break on a hash of the id, never on arrival, so re-registering in a different order cannot shuffle
  the bar. `±Infinity` is available for an item that must pin to an end.
- **Visibility is a set the user owns**, keyed by id and stored outside the item. Right-click hides;
  a single `+N` control at the right end restores. The contributor is never asked and never notified —
  hiding a readout is not a negotiation with whoever supplied it.

Registration is a hook, so an item's lifetime is its contributor's lifetime and updating it means
re-rendering — there is no imperative handle to keep in sync with React's own. Outside a provider the hook
is inert, which is what lets the phone face and the sealed public build skip a bar they do not draw.

**Its own geometry is a token, not a literal.** The strip is `--line-status`, joining the existing
`--line-input` / `--line-badge` / `--line-session-row` family of named fixed line boxes. This is not
tidiness: the shared-typography guard rejects a hardcoded `line-height`, and it was right to — the height
of the bar is a shared geometry that other components will eventually measure against, and a literal is
exactly how the 112px coupling started.

**What is registered today** is coarse: the project name and the help key as two left items, the routed
file's path when [[file-view]] is the document, the whole graph tally as one right item, the public-graph
disclosure as another. Per-chip items would give the user finer hiding, and the registry already supports
it; that is an unclaimed improvement, not a hidden limitation.

**A document contributing a fact about itself is the registry working as designed.** A file document's path
belongs to the bar for the same reason the project name does — it is persistently true of what the window
is showing — and the alternative was a title strip of its own, which is a chrome band [[ui-state-model]]
does not allot. The bar is where a persistent readout goes precisely so that no surface has to grow one.
