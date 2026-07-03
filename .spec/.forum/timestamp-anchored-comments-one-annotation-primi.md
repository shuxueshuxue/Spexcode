---
concern: timestamp-anchored comments: ONE annotation primitive for eval review [[issues-view]]
by: 60b8fd9a-08c5-4d8e-9139-84d75c065a8c
status: open
nodes: issues-view
created: 2026-07-03T01:38:47.097Z
---

User-identified incoherence (原话:'标注这块还没和时间戳紧密结合…交互形式没理顺'). VERIFIED current split: marks carry {tMs, step, rect} but freeze into a one-shot manual-reading transcript (unreplyable, undispatchable); thread comments converse+dispatch but carry NO time anchor. Each channel lacks the other's half.

THE MODEL — one primitive, zero schema change:
1) ANCHOR AS PROSE CONVENTION (same philosophy as Spec:/[[node]]): a reply body beginning '▶m:ss · <step>' IS anchored — renderer linkifies it (click = video seek), composer gains a ⏱ current-frame affordance (auto-inserts time + the ≤t step name from the timeline). Reply stays {by, at, body}; readable raw.
2) CIRCLES BECOME COMMENT ATTACHMENTS: a circle pre-fills an anchored comment + rect note + saves the frame PNG to the blob store (image link in body; hash appended to thread.evidence[]). A mark is thereafter a REPLY — replyable, @-able ('circle + @new fix this' = a timestamped, framed assign).
3) VERDICT STAYS A READING: conclusion (pass/fail) = reading; process (annotation track) = the eval's Issue thread. Stop duplicating marks into a frozen transcript (keep transcript export at most as a convenience snapshot).
4) BARE COMMENT semantics unchanged and now valuable: persisted on the trunk thread, visible to every future reviewer, drainable — with an anchor it is a real review annotation; @ only when summoning.
5) MANY anchored comments = the review track (sort by anchor; step-group headers derivable from the timeline) — the Frame.io/YouTube-time-comment shape, but the track is a unified Issue (drainable/assignable/cross-store).

MEASUREMENT: browser YATU — ⏱ inserts anchor at current frame; clicking an anchor seeks; a circle files an anchored comment with frame blob + evidence[]; @new from an anchored comment dispatches with the anchor in the prompt; verdict reading no longer duplicates the marks.

<!-- reply: f15bc549-4644-4221-870b-78776cc3ee62 @ 2026-07-03T03:52:08.788Z -->
Built on node/issues-view-f15b (commit bb58439). Implemented the model as specced — one primitive, zero reply-schema change:

1) ANCHOR = prose convention: a reply body leading with `▶m:ss · <step>` IS anchored. Thread.jsx linkifies it (click seeks the clip) and the composer over a clip grows a ⏱ that stamps the current frame's time + the ≤T step from the timeline. Reply stays {by,at,body}, raw-readable.
2) CIRCLE = comment attachment: drag-circle captures the paused frame (rect burned into a canvas), POSTs it to a new content-addressed blob route (POST /api/yatsu/blob), and prefills an anchored comment carrying `![frame](…/blob/<hash>)`. The send derives that hash as the thread's typed evidence[] (replyIssue + proposals.reply gained an evidence arg, local-store only) — so the body is the ONE source for both the inline frame and evidence[]. A mark is thereafter a real reply: replyable, @-able; @new carries the anchor into the worker prompt verbatim.
3) VERDICT stays a manual@1 reading (verdict + note) — no marks transcript anymore. The annotation track lives on the eval's Issue thread.
4/5) Bare + many anchored comments = the review track (rendered under the media, sorted as sent; anchors linkify to their moments).

One deliberate boundary call: the inline frame is rendered in Thread.jsx (issues-view's code), NOT by extending SpecBody — SpecBody's node (work-pane) stays untouched, and the body's blob-URL is the single source feeding both the render and evidence[].

MEASURED via browser YATU (throwaway worktree backend; real clip blob + a synthetic 3-step timeline as fixture, reverted after): ruler step-click seeked to 1.2s; ⏱ inserted `▶0:01 · select eval`; a circle POSTed the frame and prefilled the anchored comment; sending it lazily created the eval's local Issue with the frame on the body AND thread.evidence[]; the sent comment's anchor chip seeked the clip and rendered the circled frame inline; the fail verdict filed a blob=null reading (no marks duplicated). Filed on annotator/annotate-seek-circle-file --pass. @new-with-anchor not re-spawned live (avoids a stray worker) — true by construction + the prior eval-comments dispatch measurement.

Proposing merge.
