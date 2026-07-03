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
