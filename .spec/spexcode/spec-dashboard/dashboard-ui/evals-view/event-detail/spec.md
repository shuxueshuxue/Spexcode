---
title: event-detail
status: active
hue: 200
desc: The ONE evidence+reply detail pane (U1), store-agnostic, reused in EVERY home — the Evals page ([[evals-view]]) AND the session eval tab. A selected reading as a WORKSPACE — slim header (verdict badge + A/B strip), the media STAGE center (video under a custom review-track scrubber; the human scrubs, circles; images/transcripts render whole), the REMARK track in an always-visible right RAIL with the composer docked at its foot — circle on the stage, remark right there, no vertical ping-pong. The (node,scenario) remark track rides as entry.thread — a resolved remark renders settled, an open one prominent. The pane reads readings and hosts remarks; it never files one.
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
**remark** on a video host, and the pane that shows it is just **the** evidence+reply detail. So there is ONE
`EventDetail` component, store-agnostic, reused in every home a reading is inspected — the Evals page
([[evals-view]]) and the session eval tab render the SAME media + remark thread + composer, never two
drifting surfaces.

## expanded spec

`EventDetail` IS the **detail pane for a selected eval reading** ([[evals-view]]'s master-detail — no
modal, no box-in-a-box: the reading gets the pane's full height, and switching selection resets the working
state to the new reading — the remark composer's draft included: the composer is keyed to the (node,
scenario) identity, so a half-typed or circle-prefilled remark dies with its selection instead of leaking
onto another eval's composer, where sending it would post one scenario's remark onto another scenario's
thread). The pane is a **WORKSPACE, not a scroll stack** — the review act is a loop
(*circle a moment on the clip, say what's wrong, circle the next*), and a layout that stacks
media→thread→composer vertically forces a scroll ping-pong between the frame (top) and the composer
(bottom) on every mark. So the pane splits into three fixed regions, the annotator shape: a **slim HEADER
band** (scenario · node · the verdict badge · timestamp · the FILER's liveness · the A/B strip
right-aligned), a center
**MEDIA STAGE**, and an always-visible **RIGHT RAIL** carrying the remark track with the composer **docked
at the rail's foot**. The docked composer is the console-❯-box SHAPE ([[issues-view]]'s shared thread
composer): its writing surface is already usable at idle — a multi-line box a few lines tall, never a
one-line sliver you must click to expand (the box you land on is the box you write in) — that auto-grows
with the draft above that floor and reveals its actions row (⏱ / Send) only while engaged, so the write
affordance is permanent, usable on sight, but never bulky. Stage and rail scroll *independently* — the media never scrolls out of view while
remarking, and the composer is never below the fold: circle→remark→circle→remark without moving anything.
At narrow widths the workspace degrades gracefully back to one stacked column (the rail folds under the
stage), and the composer stays a **sticky bar at the column's foot** — the one-column mode keeps the
docked-writer geometry instead of burying the composer under the thread. The header's **filer chip** names the session that FILED this scenario's reading, with a liveness dot
(alive = the session is on the board and not offline, its live `STATUS_COLOR` painting the dot, [[state]];
offline otherwise). A live filer chip is the direct door to the session's CONSOLE: click it and the
dashboard opens `#/sessions/<id>` with the terminal showing. On the session eval tab — where the filer is
routinely the very session being viewed — the host makes that meaning real by flipping its right pane to
the terminal ([[session-console]]), so a same-session click is never a dead no-op. Offline filers stay static, and the header
does not spell out the courtesy-delivery mechanics in a reach phrase. The filer is the LATEST reading's
`by` (the chain's first link; the reading carries it from the eval seam via `evalTimeline`); a legacy reading
without `by` resolves to nobody and the header simply shows no filer.

A reading's evidence is a **LIST**, so every entry renders on the ONE stage — and U1's "one evidence
detail" is literal code: the per-entry renderer is the extracted **`Evidence.jsx`**, this node's second
file — one kind-dispatch (`EvidenceItem`: video → an inline player, image → click-to-enlarge, transcript →
text, a pruned blob → the honest miss sentinel) reused verbatim by the node eval tab's gallery
([[eval-tab]]'s `NodeView`) and by a reply's inline blob links ([[issues-view]]'s `Thread`, which
resolves a bare hash's kind from the blob route's served Content-Type), so a blob renders identically
wherever it appears. The ONE deliberate specialization is this pane's **clip player**: on this stage the
**video** plays under a **custom review-track scrubber** — native chrome replaced so the timeline can
carry the review: anchored remarks are **markers** on it, the playhead **lights the remark it is inside**,
and clicking a marker (or a remark in the rail) **seeks** there. The surface is **keyboard-driven** — play/pause,
coarse and frame-fine scrubbing, jump between remarks, and **annotate the current frame** (its
`▶m:ss · step` and the captured frame itself stamped into the composer). Because that custom bar **replaces** native chrome — its
built-in fullscreen included — the bar carries an explicit **fullscreen control**: the ONE shared
`FullscreenButton` ([[video-evidence]]'s `Evidence.jsx`), `requestFullscreen` on the whole player wrapper
(stage + bar, so the review-track controls stay usable large). It exists on every media home a *video*
renders: a plain `<video controls>` (the eval-tab gallery, a thread's blob link) gets fullscreen from its
native controls, and only a controls-suppressed player (this clip player) grows the explicit button — one
control, never doubled where the native chrome already offers it. An **image gallery** renders on the stage beside/under the clip —
each still full-width and **click-to-enlarge** (a click opens that blob in a viewport-size lightbox; click
anywhere or Esc closes, the Esc swallowed so the page's own Esc stack never fires — a screenshot's detail is
the evidence, and the stage's width is not its ceiling). A transcript entry renders as
text, a missing blob as the honest sentinel per entry, a blob-less (`note`) reading its verdict note as the text
body (never an empty media box). A **structured `data`** entry ([[evidence-kind-taxonomy]]) renders as its
validatable block, but **FOLDS behind its own header when the reading ALSO carries a clip or still** — the
media is the protagonist and the data a secondary drill-down, so it must not push the video/gallery off the
stage; a **data-only** reading keeps it open, since the block IS the evidence (a native fold, no JS state).
When the reading
carries a [[step-timeline]]
sidecar, a **step ruler** renders naming each step at its position — labels keyed by the map's **axis**
(time→m:ss, frame→#123, line→L42, index→3/N), so the rail is no longer welded to the clip: a **non-video**
reading (a transcript's `line` steps) shows its rail too. On a **video** (the `time` axis) the scrubber also
**bands its step boundaries** and a live chip names the step the playhead is in, and clicking a ruler step
seeks to its position; a remark at position P names its step by the last-boundary-≤P lookup, and a step's
optional owning-node routes the finding to the node it actually belongs to. Without a sidecar it is a plain
player/evidence view with remarks — degraded gracefully, never blocked.

**The A/B strip — a scenario's fail→pass lifecycle, walkable in place.** A bug fix leaves a *pair* of
readings on one scenario — the **A** (the reproduced failure) and the **B** (the verified fix), the
[[reproduce-before-fix]] contract's proof-of-work — and the error→correct transition is only legible when
you can see both. So the pane is not pinned to the latest reading: in the header band a compact **A/B strip**
renders the scenario's WHOLE reading history as verdict pips (oldest→newest, ✗ = a fail/A pole, ✓ = a
pass/B pole, · = a pre-verdict legacy reading), the viewed one lit, with **‹ ›** to walk older→newer and a
click on any pip to jump. Flipping swaps the media *in place* — the video/gallery, the step ruler, the
expected, the verdict note, and the header's verdict badge all re-render for the selected reading — so A
(the bug) and B (the fix) sit one keystroke apart.

**A stale reading is shown, so the detail EXPLAINS its staleness.** Because the feeds no longer hide stale
readings ([[evals-feed]]), a stale one is routinely the viewed reading — and a bare "stale" is not enough to
act on. So the stage carries a small **stale readout** for a non-fresh viewed reading: the freshness axes that
moved since it (`code · scenario · remark`), and for the **code** axis which governed files drifted
and by **how many commits** (`EvalsFeed.jsx +3`) — the per-file drift count is [[eval-core]]'s `codeDrift`,
attached to the reading by `evalTimeline` (the frontend has no git). It is reporting only: it never decides
freshness, it names a decision already made, so a reviewer sees *why* a reading is behind and by how far. Every
other affordance is freshness-blind — a remark is authored on a stale reading exactly as on a fresh one (the
composer never consults freshness); staleness changes what the loss signal *says*, never what the human can *do*. The A/B
history is **HOME-PROVIDED, so it shares each home's ROOT** — the store-agnostic pane never assumes one timeline
source. The [[evals-view]] page passes none and the pane lazily fetches the node's `/api/specs/:id/evals`
timeline the [[eval-tab]] uses (the board folds only the latest reading per scenario, [[graph-lean]], so
walking the poles needs this one read). The **session eval tab** instead supplies its already-computed
**WORKTREE-rooted** readings for the scenario ([[session-eval]]) — because on that home the selected reading is
the session's own **un-merged in-session** reading, which lives in the branch's worktree and is therefore ABSENT
from the main-checkout `/api/specs` timeline; re-fetching it there would strand the current video behind an
older inherited reading and disable the newer-nav. Either way there is no new endpoint and no board bloat; the
strip shows only when a scenario has more than one reading (a fresh scenario is just its single reading). The remark track in the rail is
per-SCENARIO, not per-reading, so it stays stable as you flip — it spans the whole A/B. New readings
arrive only from the eval seam's CLI ([[eval-core]]'s `spex eval add`) and surface here on the next
refresh; the pane never mutates or appends the scenario's history itself.

**One reply primitive — a REMARK on the eval's own (node, scenario) thread.** Discussion and annotation are
the same act, and on a scenario that act is a **remark** ([[remark-substrate]]) — a scenario-scoped concern
is never an issue (I1: else the loss signal could be bypassed). The rail renders the eval's thread
([[issues-view]]'s shared `Thread`), and every mark is a remark on it, carrying the mutable `resolved` bit.
The track is the thread's **remarks** — the `rid`-carrying replies — NOT its container root: an eval thread's
body is a system-minted stub (`Remarks on the <scenario> eval of <node>`) that find-or-create writes to
close the race window, and it is never a remark ([[remark-substrate]]: every remark is a reply, never the
thread body), so it renders as neither a track row nor a count — the rail shows exactly the remarks, once each.
A remark is **anchored** by a prose convention — the same philosophy as `Spec:` and `[[node]]` — a body
whose first line reads `▶m:ss · <step>` IS anchored to that video moment: the renderer linkifies it (click
seeks the clip), and the composer over a clip gains a **⏱** affordance that stamps the current frame — its
time + the ≤T step name from the timeline, AND the frame itself as the mark's image. Sorted by their anchor, the anchored remarks **are** the review
track over the clip — the Frame.io/YouTube-time-comment shape, literally the markers on the scrubber, the
active one lit as it plays. A remark's **`resolved` state renders in place** ([[remark-teeth]]): an open
remark is prominent (the loss the eval scoreboard is still carrying), a resolved one is visually settled
(dimmed, ✓) — the eval's outstanding loss is legible at a glance, not hidden in a badge. The bit is also
**writable in place, at CLI parity** ([[remark-substrate]] LAW L): an unresolved remark row carries its one
applicable verb — **resolve** on an agent's remark (the human's deliberate second-party judgment, the same
`/api/remarks/resolve` an agent's `spex resolve` parallels; never on the human's own, mirroring the
server's self-resolve rejection) or **retract** on the human's own (author-only withdrawal). A resolved
remark is settled and immutable — monotonic, no verb — and a refused action surfaces its server message on
the row. The reload rides the host's existing write path, so the teeth clear on the same signal a filed
remark fires.

**An anchored mark carries its moment's frame — whichever gesture made it.** The three mark gestures
(a drag-**circle** on the paused frame, the composer's **⏱** stamp, the keyboard's **`a`**) are ONE act
through one capture: grab the current frame to the blob store (the circle burns its rect in; ⏱/`a` take
the clean frame) and anchor a remark carrying it — the `▶m:ss · step` line, the frame as a
`![frame](/api/evidence/<hash>)` image link in the body, and — when the step's owning node differs — a
`[[node]]` routing line (circle/`a` prefill the composer; ⏱ stamps the head of the draft in place,
keeping the prose, and a re-stamp at a new moment replaces the anchor line AND its riding frame together,
so an anchor and its frame never disagree — only a frame sitting right under the anchor line is the
anchor's own; frames deeper in the prose are the author's). So the review track renders uniformly: every
anchored remark is chip + frame thumbnail (+ prose), a ⏱/`a` mark indistinguishable in shape from a
circle mark. A failed capture degrades to the text-only anchor (the capture flash reports it), never a
blocked mark. The frame's hash, derived from that body link, is the remark's typed `evidence[]` on the
thread; the body is the one raw-readable source. A mark is thereafter an ordinary reply — replyable,
`@`-able: `circle + @new fix this` is a timestamped, framed assign, the anchor riding into the dispatched
worker's prompt verbatim.

**The pane is READ-side on readings — it files none.** A reading's verdict renders (the header badge, the
A/B pips, the note) but is never authored here: readings are filed by AGENTS through the eval seam's CLI
(`spex eval add`, [[eval-core]]) *with evidence* — a human pass/fail click would file an evidence-less
`manual@1` hand-vote, ruled useless, so the pane carries no verdict footer. The human's judgment speaks
through the REMARK composer: an open remark ages the scenario like a drift event ([[remark-teeth]]), so a
human "this is wrong" reaches the loss signal without minting a blind reading. A finding belonging to
*another* node is an anchored remark routing to that node's thread ([[video-evidence]]'s routing). This
pane invents no verdict states, no timeline tables, no locks.

**The thread rides one server-side overlay — folded in as `entry.thread`, the SAME on both homes.** The
eval's remark track IS the ONE local Issue for this (node, scenario), keyed by its `eval: <node> · <scenario>`
concern. It is no longer re-matched client-side against a resident issues list: the (node,scenario)↔thread
join is the server overlay ([[remark-teeth]] / [[eval-issue-split]]), attached to each reading by
`evalTimeline` and so present on **every** home — the Evals-page feed folds it in through the board, the
session tab through the proof model. The composer authors a **remark** through the CLI-parity `/api/remarks`
(find-or-create by (node, scenario) — no thread id or concern needed on the write side; identity is
server-derived `'human'`, L: no dashboard-only write): the first remark mints the thread, every later one
appends; an `@session`/`@new` typed in it dispatches ([[mentions]]), and a `/` at the line's start opens the
review track's typed command menu ([[review-commands]] — /ok as the header sign-off's typed twin, `surface:
review` presets as prefills; the send stays this same remark write). Because the write path needs no resident
list, the pane renders on **EVERY** eval home — a fresh scenario shows an empty track with a live composer,
and the session eval tab's old "no resident issues list" degradation is gone (it now renders the full thread
+ composer like the issues page). The reply list and composer are the SAME shared thread UI the issue detail
uses ([[issues-view]]'s `Thread.jsx` — one thread UI, three homes: local issue, forge issue, eval reading).
