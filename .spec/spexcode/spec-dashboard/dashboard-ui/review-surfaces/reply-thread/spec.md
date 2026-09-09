---
title: reply-thread
status: active
hue: 250
desc: The ONE thread surface every discussion home renders — the reply list, its docked composer, and the marks a reply can carry (time anchor, evidence) — so a local thread and a forge thread are the same component, never two dialects.
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

Two pages held a discussion — an issue's detail ([[issues-view]], both stores) and a scenario's
(node,scenario) remark thread — and both rendered the SAME component, `Thread.jsx`, while both nodes'
bodies said so out loud: the second one's spec called it *the SAME shared `Thread.jsx` the issue detail
uses*, and pointed at the issue page for the composer's shape. So the file was **described by two
nodes and governed by neither**: nothing tracked its drift, no version answered for it, and a change to the
thread had to be argued twice or silently in one place. That is the gap this node closes — one component,
one governing home, and the two pages reference it instead of re-describing it.

## expanded spec

- **ONE thread surface, every home.** The reply list and its composer are one component set, not a per-page
  copy: an issue thread, local or forge — store never changes the thread's shape — renders the same
  replies, the same composer, the same marks in every home. A home supplies DATA and handlers (what
  to post through, whose node leads the mention list, whether a clip can be seeked); it never supplies a
  variant of the thread.
- **A reply's marks live IN the reply.** A reply is `{ by, at, body }` and may carry a time anchor
  (`▶m:ss · step`) and evidence blobs. Those are rendered from the reply's own text by the one shared
  [[prose-renderer]] — node references, time anchors and evidence are its semantic tokens, and this node
  supplies only what each token DOES in a thread (navigate, seek, show) — so every home that shows a thread
  shows them; a home that cannot act on one (no clip to seek) renders it inert rather than hiding it. A reply
  row carries no per-reply verb and no state badge: the thread's lifecycle acts (close, promote) ride the
  composer's action row, never a reply.
- **The writing surface is not this node's to invent.** The composer's shell — the quiet bordered container,
  the auto-growing borderless textarea, the persistent action row, the IME Enter boundary — is [[composer]];
  the `@`/`[[` doors and their menu are [[mentions]]. This node owns what a THREAD needs from them: which
  actions ride the row, what a send posts through, and that the menu opens where the composer sits (upward
  from a docked composer, downward on a page). It adds no second editor and no second menu — the composer
  has no `/` palette; `/` is the session console's grammar ([[command-box]]), not a thread's.
- **Identity is shown, never inferred twice.** A reply's author renders through the one liveness-aware
  originator chip where the home can join it against the board, and as a plain labelled value where it
  cannot (a forge login resolves to no session). The chip's behaviour is the shared side-rail primitive's
  ([[review-chrome]]), skinned — never a parallel span/anchor variant.
- **Delivery stays the caller's.** `onSend(text, evidence)` is the whole write contract: the thread does not
  know whether it is replying to a local file, a forge comment, or creating a thread lazily — the home routes
  it by the issue's own store ([[issues]]). An `@session` reference remains in that authored text and never
  dispatches; `@new` is [[mentions]]'s one explicit worker action, and the thread's composer offers the same
  launcher chooser every other input box does.
