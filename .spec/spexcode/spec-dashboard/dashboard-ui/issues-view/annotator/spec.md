---
title: annotator
status: active
hue: 200
desc: The issues page's eval DETAIL pane — a selected reading full-height (a video plays with a clickable step ruler; the human scrubs, circles, comments; images/transcripts render whole). There is ONE annotation primitive — a time-anchored comment on the eval's own Issue thread — and the verdict stays a separate reading.
code:
  - spec-dashboard/src/Annotator.jsx
related:
  - spec-yatsu/src/evaltab.ts
  - spec-yatsu/src/filing.ts
  - spec-cli/src/index.ts
  - spec-dashboard/src/NodeView.jsx
---
# annotator

## raw source

The human's measuring hand on a recorded user loop: watch the clip, point at the moment something is
wrong, say what — and have that judgment land where it belongs, as one durable, conversable thing. The
annotator is an authoring surface over an **already-captured** clip; yatsu still runs nothing, and no new
ledger structure exists for its sake. An annotation and a comment were once two half-channels — a mark
carried a timestamp but couldn't be replied to or dispatched; a comment could converse but had no time
anchor. They are **one primitive**: a time-anchored comment on the eval's own thread.

## expanded spec

The annotator IS the issues page's **detail pane for a selected eval** ([[issues-view]]'s master-detail —
no modal, no box-in-a-box: the reading gets the pane's full height, and switching selection resets the
working state to the new reading). Every evidence kind renders here — an image full-width and
**click-to-enlarge** (a click opens the same blob in a viewport-size lightbox; click anywhere or Esc
closes, the Esc swallowed so the page's own Esc stack never fires — a screenshot's detail is the
evidence, and the pane's width is not its ceiling), a transcript as
text, a missing blob as the honest sentinel, a blob-less (`note`) reading its verdict note as the text
body (never an empty media box) — and a **video** reading plays its clip. When the reading
carries a [[step-timeline]]
sidecar, a **step ruler** renders under the scrubber — click a step to seek to its `tMs`; an annotation at
moment T names its step by the last-boundary-≤T lookup, and a step's optional owning-node routes the
finding to the node it actually belongs to. Without a sidecar the annotator is a plain player with
comments — degraded gracefully, never blocked.

**One annotation primitive — a time-anchored comment on the eval's thread.** Discussion and annotation are
the same act: the pane renders the eval's comment thread ([[issues-view]]'s shared `Thread`), and every
mark is a comment on it. A comment is **anchored** by a prose convention — the same philosophy as `Spec:`
and `[[node]]` — a body whose first line reads `▶m:ss · <step>` IS anchored to that video moment: the
renderer linkifies it (click seeks the clip), and the composer over a clip gains a **⏱** affordance that
stamps the current frame (its time + the ≤T step name from the timeline). The reply stays plain
`{ by, at, body }` — no schema grows, and a raw reader still sees the `▶m:ss` line. Sorted by their anchor,
the anchored comments read as a **review track** over the clip (the Frame.io/YouTube-time-comment shape),
but the track is a unified Issue — drainable, assignable, cross-store.

**A circle is a comment with a frame.** Drag-circling a region on the paused frame captures that frame to
the blob store (the rect burned in) and **prefills an anchored comment** carrying it: the `▶m:ss · step`
line, the frame as a `![frame](/api/yatsu/blob/<hash>)` image link in the body, and — when the step's
owning node differs — a `[[node]]` routing line. The frame's hash, derived from that body link, is the
comment's typed `evidence[]` on the thread; the body is the one raw-readable source. A mark is thereafter
an ordinary reply — replyable, `@`-able: `circle + @new fix this` is a timestamped, framed assign, the
anchor riding into the dispatched worker's prompt verbatim.

**The verdict stays a reading.** The conclusion (pass/fail + a note) is a `manual@1` reading filed through
the eval seam's write half (filing.ts, [[yatsu-core]]); it no longer duplicates the marks into a frozen
transcript — the annotation track lives on the thread, and the reading records only the verdict. A finding
belonging to *another* node is already handled: it is an anchored comment routing to that node's thread
([[video-evidence]]'s routing; the marks are the prose body, the clip and step-map among the thread's
`evidence[]`). The annotator invents no verdict states, no timeline tables, no locks.

**The thread rides the Issue mechanism — an eval's comment thread IS a local Issue.** It is deterministically
bound to this (node, scenario) by its concern key — `eval: <node> · <scenario>` — matched by concern TEXT
against the page's resident issues list (ids de-collide, concerns don't). No thread exists until someone
speaks: the first comment lazily creates it through the SAME propose the CLI uses (`nodes: [node]`, the
comment as the body), every later comment replies through the SAME reply — one thread per pair, forever,
whatever its status. The reply list and composer are the SAME shared thread UI the issue detail uses
([[issues-view]]'s `Thread.jsx` — one thread UI, three homes: local issue, forge issue, eval), so an
`@session`/`@new` typed in a comment dispatches ([[mentions]]), and the thread lists in the issues group
like any local issue with its node chip focusing the graph. Where no resident issues list is wired in (the
session eval tab), the section does not render — a blind post would mint duplicate threads, so there the
clip is a plain player with the verdict only.
