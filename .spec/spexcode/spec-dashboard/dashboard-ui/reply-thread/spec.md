---
title: reply-thread
status: active
hue: 250
desc: The ONE thread surface every discussion home renders — the reply list, its docked composer, and the marks a reply can carry (time anchor, evidence, remark verbs) — so an issue thread and an eval's remark thread are the same component, never two dialects.
code:
  - spec-dashboard/src/Thread.jsx
related:
  - spec-dashboard/src/Composer.jsx
  - spec-dashboard/src/Evidence.jsx
  - spec-dashboard/src/mentions.jsx
  - spec-dashboard/src/styles.css
---

# reply-thread

## raw source

Two pages hold a discussion: an issue's detail ([[issues-view]], both stores) and an eval's detail
([[event-detail]], the (node,scenario) remark thread). They render the SAME component — `Thread.jsx` — and
both nodes' bodies say so out loud: the eval detail's spec calls it *the SAME shared `Thread.jsx` the issue
detail uses*, and points at the issue page for the composer's shape. So the file was **described by two
nodes and governed by neither**: nothing tracked its drift, no version answered for it, and a change to the
thread had to be argued twice or silently in one place. That is the gap this node closes — one component,
one governing home, and the two pages reference it instead of re-describing it.

## expanded spec

- **ONE thread surface, every home.** The reply list and its composer are one component set, not a per-page
  copy: an issue thread (local or forge — store never changes the thread's shape) and an eval's remark
  thread render the same replies, the same composer, the same marks. A home supplies DATA and handlers (what
  to post through, whose node leads the mention list, whether a clip can be seeked); it never supplies a
  variant of the thread.
- **A reply's marks live IN the reply.** A reply may carry a time anchor (`▶m:ss · step`), evidence blobs,
  and — when it is a remark ([[remark-substrate]]) — its resolve/retract verb with its resolved bit. Those
  are parsed from and rendered with the reply, so every home that shows a thread shows them; a home that
  cannot act on one (no clip to seek) renders it inert rather than hiding it.
- **The writing surface is not this node's to invent.** The composer's shell — the quiet bordered container,
  the auto-growing borderless textarea, the persistent action row, the IME Enter boundary — is [[composer]];
  the `@`/`[[` doors and their menu are [[mentions]]. This node owns what a THREAD needs from them: which
  actions ride the row, what a send posts through, and that the menu opens where the composer sits (upward
  from a docked composer, downward on a page). It adds no second editor and no second menu.
- **Identity is shown, never inferred twice.** A reply's author renders through the one liveness-aware
  originator chip where the home can join it against the board, and as a plain labelled value where it
  cannot (a forge login resolves to no session). The chip's behaviour is the shared side-rail primitive's
  ([[review-chrome]]), skinned — never a parallel span/anchor variant.
- **Delivery stays the caller's.** `onSend(text, evidence)` is the whole write contract: the thread does not
  know whether it is replying to a local file, a forge comment, or creating a thread lazily — the home routes
  it by the issue's own store ([[issues]]), and an `@`-mention dispatches from wherever it was typed because
  every send lands on the same store-routed write path.
