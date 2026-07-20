---
title: event-detail
status: active
hue: 200
desc: The ONE evidence+reply detail (U1), store-agnostic — the content of the Evals DETAIL page ([[evals-view]], inside [[review-chrome]]'s shell): status band wearing the verdict badge + A/B strip; the MAIN column an evidence WORKSPACE (video under a custom review-track scrubber, the human scrubs and circles; gallery/transcripts/data through the one Evidence renderer) followed by the (node,scenario) remark thread with the composer DOCKED STICKY at the column's foot; the reading/session metadata (evaluator, time, filer liveness, human-ok, staleness readout) in the side rail. Reads readings and hosts remarks; never files one.
code:
  - spec-dashboard/src/EventDetail.jsx#EventDetail
  - spec-dashboard/src/EventDetail.jsx#StepRail
  - spec-dashboard/src/EventDetail.jsx#EvalRemarks
related:
  - spec-eval/src/evaltab.ts
  - spec-cli/src/index.ts
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/Thread.jsx
  - spec-dashboard/src/Evidence.jsx
---
# event-detail

## raw source

The human's measuring hand on a recorded user loop: watch the clip, point at the moment something is
wrong, say what — and have that judgment land where it belongs, as one durable, conversable thing. This is
an authoring surface over an **already-captured** reading; eval still runs nothing, and no new ledger
structure exists for its sake. "Annotator" was never a real concept (U1): an annotation is just an anchored
**remark** on a video host, and the pane that shows it is just **the** evidence+reply detail. There is ONE
`EventDetail` component; with the master-detail era gone it has ONE home — the Evals DETAIL page
([[evals-view]]), project- or session-scoped — and it wears GitHub's issue-page grammar there
([[review-chrome]]): evidence is the "description+activity" main column, reading metadata the side rail.

## expanded spec

`EventDetail` fills the [[review-chrome]] `DetailShell` for one (node, scenario): the **header** names the
scenario (title) with the node as its trailing meta; the **status band** carries the verdict badge and the
**A/B strip**; the **MAIN column** is the evidence workspace then the remark thread with its composer
docked at the foot; the **SIDE rail** is the reading/session metadata, every value through
[[review-chrome]]'s ONE SideValue primitive (shrink + ellipsis, full text on the tooltip — a filer UUID
never stretches the rail) — evaluator, filed time, the reading's **spec node as a REAL labeled ref**
(the shell's graph-focus door; a host wiring none still shows the labeled value), the FILER
chip with its liveness dot (alive = the session is on the board and not offline, painted by the live
`STATUS_COLOR`, [[state]]; a live chip click-throughs to `#/sessions/<id>`; a legacy reading without `by`
shows none), the [[human-ok]] settled mark when signed, and the **stale readout** for a non-fresh viewed
reading — the freshness axes that moved, and for the code axis which governed files drifted by how many
commits ([[eval-core]]'s `codeDrift`; reporting only, never deciding) — and, when the page supplies
neighbors, the **continue-reviewing queue** at the rail's foot ([[evals-view]] computes it from the
page's source dataset, split into its Previous / Up next positional groups): each row a REAL detail
anchor wearing the ONE shared verdict visual plus its
scenario and node, an empty group rendering no heading, no private selection state, the whole section
absent when no neighbor exists. At phone
width the side metadata reflows ABOVE the workspace in one column ([[review-chrome]]), and the composer
stays a sticky bar at the
column's foot. The composer's review identity is the source scope + (node, scenario) + currently viewed
reading: an unrelated board repaint keeps that identity, the A/B cursor, timeline, ordinary typed prose,
and anchored prefill intact; changing scope, scenario, or A/B reading changes it and remounts the composer,
so every kind of draft dies before the new evidence is reviewable. A draft can never post onto another
scope, scenario, or reading.

A reading's evidence is a **LIST**, so every entry renders on the ONE stage — and U1's "one evidence
detail" is literal code: the per-entry renderer is the extracted **`Evidence.jsx`** — one kind-dispatch
(`EvidenceItem`: video → an inline player, image → click-to-enlarge lightbox whose Esc is swallowed,
transcript → text, a pruned blob → the honest miss sentinel) reused verbatim by the node eval tab's
gallery and by a reply's inline blob links (kind resolved from the blob route's served Content-Type).
**Media keeps its INTRINSIC geometry** (GitHub's detail-media behavior): an image or clip renders at its
native size — `inline-size: auto` capped by `max-inline-size: 100%` with `block-size: auto` — so a piece
larger than the main column's available width scales down proportionally to fit, and a smaller one keeps
its native pixels, never stretched or upscaled to fill the column. That law covers every media home alike
(the clip stage, the still gallery, a reply's inline frames), no home may flex-stretch its children wide,
and no evidence — however oversized or tall, at any viewport down to phone width — ever widens the page.
A shrunk clip keeps its full custom review-track controls and timeline; the player chrome shrink-wraps
the clip it plays rather than stretching the clip to fill the column, keeping only a small usability
floor for the control bar — under a tiny clip the scrubber never crushes to a sliver (the floor widens
the bar alone; the clip still renders at its native size). The
ONE deliberate specialization is this workspace's **clip player**: the video plays under a **custom
review-track scrubber** — native chrome replaced so the timeline can carry the review: anchored remarks
are **markers** on it, the playhead lights the remark it is inside, and clicking a marker (or an anchored
remark in the thread) **seeks**. The surface is keyboard-driven — play/pause, coarse and frame-fine
scrubbing, ↑/↓ between remarks, `a` = annotate the current frame — and the bar carries the ONE shared
`FullscreenButton` (native chrome is suppressed here; every plain `<video controls>` home keeps its native
door). A structured `data` entry folds behind its header when the reading also carries media
([[evidence-kind-taxonomy]]); a blob-less reading shows its verdict note as the body, never an empty box.
With a [[step-timeline]] sidecar, a **step ruler** renders naming each step at its axis position
(time→m:ss, frame→#123, line→L42, index→3/N) — on a video the scrubber also bands the boundaries and a
live chip names the current step; a non-video reading with a sidecar shows its ruler too. Without a
sidecar it is a plain evidence view with remarks — degraded gracefully, never blocked.

**The A/B strip — a scenario's fail→pass lifecycle, walkable in place, BOUNDED to one line.** A bug fix
leaves a pair of readings ([[reproduce-before-fix]]): the A (reproduced failure) and the B (verified fix).
The status band renders the viewed verdict and the scenario's WHOLE history through [[review-chrome]]'s
ONE shared icon/label/tone mapping (oldest→newest), the viewed one lit, with shared chevron buttons to
walk — flipping swaps the media, expected, note, and badge in place, so A and B sit one keystroke apart.
The strip is a **single line at a stable height however many readings accrue**: at most EIGHT recent
readings render as pips, and when the viewed reading falls outside that recent window it **takes one of
the eight slots** (leftmost — it is the oldest shown), clearly selected, so the current reading is always
visible. Every reading not holding a pip collapses behind ONE accessible **overflow menu** (the shared
popover mechanics — menuitemradio rows wearing the same shared verdict visual plus position and filed
time; picking a row views that reading), so a hundreds-deep history neither wraps the band tall nor loses
any reading's reach, and no walk or pick ever changes the band's height. The history is
**SCOPE-PROVIDED, sharing the page's root**: the project scope lazily fetches the node's
`/api/specs/:id/evals` timeline (the board folds only the latest per scenario, [[graph-lean]]); the
`?q=scope:<id>` scope supplies the WORKTREE-rooted readings ([[session-eval]]) — the un-merged in-session
reading lives only in the branch's worktree, and re-fetching the main-checkout timeline would strand the
current video behind an older inherited one. The strip shows only when a scenario has more than one
reading. New readings arrive only from the eval seam's CLI (`spex eval add`, [[eval-core]]); the pane
never mutates the history.

**One reply primitive — a REMARK on the eval's own (node, scenario) thread.** A scenario-scoped concern is
never an issue (I1). The thread renders under the workspace as the page's activity — the SAME shared
`Thread.jsx` the issue detail uses — and its track is the thread's `rid`-carrying replies, never the
system-minted container stub. A remark is **anchored** by the `▶m:ss · <step>` first-line convention: the
renderer linkifies it (click seeks), and over a clip the composer gains the **⏱** stamp. An open remark
renders prominent, a resolved one settled ([[remark-teeth]]); the bit is writable in place at CLI parity
([[remark-substrate]] LAW L — resolve on an agent's remark, retract on one's own; a refusal surfaces its
server message). The composer is [[issues-view]]'s ONE shared thread composer (quiet bordered container,
two-line floor, auto-grow, persistent action row with the `@`/`[[`/`/` triggers and icon-only Send),
**docked sticky at the main column's foot** — the thread scrolls behind it, so circle→remark→circle never
buries the writer. It authors through the CLI-parity `/api/remarks` (find-or-create by (node, scenario),
author `'human'`, L: no dashboard-only write); an `@session`/`@new` dispatches ([[mentions]]); a leading
`/` opens the review-track command menu ([[review-commands]] — `/ok` as the ONE dashboard door to the
[[human-ok]] sign-off, presets as prefills). A fresh scenario shows an empty track with a live composer.

**An anchored mark carries its moment's frame — whichever gesture made it.** The three mark gestures (a
drag-circle on the paused frame, ⏱, the keyboard's `a`) are ONE act: grab the current frame to the blob
store (the circle burns its rect in), anchor a remark carrying the `▶m:ss · step` line, the frame as a
`![frame](/api/evidence/<hash>)` link (the hash becoming the remark's typed `evidence[]`), and — when the
step's owning node differs — a `[[node]]` routing line. A re-stamp replaces the anchor line AND its riding
frame together; a failed capture degrades to the text-only anchor, never a blocked mark. A mark is
thereafter an ordinary reply — replyable, `@`-able: `circle + @new fix this` is a timestamped, framed
assign riding into the dispatched worker's prompt verbatim.

**READ-side on readings — it files none.** Verdicts render but are never authored here: readings are filed
by agents through the eval seam WITH evidence; a human pass/fail click would mint a blind `manual@1`
hand-vote, ruled useless. The human's judgment speaks through the remark composer (an open remark ages the
scenario, [[remark-teeth]]). The thread rides ONE server-side overlay folded in as `entry.thread`
([[eval-issue-split]]) — never re-matched client-side against a resident issues list. Freshness changes
what the loss signal *says*, never what the human can *do* — the composer never consults it.
