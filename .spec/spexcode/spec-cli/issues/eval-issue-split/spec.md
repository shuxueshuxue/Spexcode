---
title: eval-issue-split
status: active
hue: 30
desc: M3 of the eval/issue/remark refactor — kill "forum" at the substrate, read-time-SPLIT eval-remark tracks OUT of the issue surfaces (they are the eval scoreboard's data, not the issue drain), and reach U1 (one EventDetail component). One store, two complementary reads by concern key.
---
# eval-issue-split

## raw source

An eval-remark thread and a taste proposal were living in ONE list and reading as the same kind of thing —
both "issues" on the board badge, both in the drain, both in the Issues page's list. But a **scenario-scoped
concern is a remark, not an issue** (I1): it ages a scenario's loss and clears only by the teeth
([[remark-teeth]]); it must never be a drainable issue, or the loss signal could be bypassed by resolving it
as an issue. So the two must **split**, read-time, over the one file store — and the word "forum", which
still named the local store everywhere in the code, had to go with them: the local store is just where a
**local Issue** lives, not a second concept.

## expanded spec

Three moves, one milestone — all read-time, no storage migration (the `.spec/.forum/` directory stays put; a
data-dir rename would touch every deployment, so it is left as deliberate residue, its identifiers renamed
around it).

- **Kill "forum" at the substrate.** The local issue store's code no longer speaks "forum": its data-level
  identifiers are the issues model — `postLocalIssue` / `replyLocalIssue` (the programmatic write
  entrypoints), `localStoreDir` / `LOCAL_STORE_REL` (the venue), `withStoreLock` / `commitStore` /
  `writeStoreFile` (the write mechanism). The dashboard route is `#/issues` (not `#/forum`), the side-nav
  entry reads **Issues**, and the user-facing prose says "issues page", never "Forum". [[proposals]] still
  OWNS the local store's whole mechanism; it is simply named as what it is — the local store of [[issues]].

- **Read-time split by concern key.** An eval-remark thread's tell is its concern, `eval: <node> ·
  <scenario>` (`isEvalConcern`). Two complementary reads run over the ONE store: `mergedIssues` (the read
  every ISSUE surface consumes) **excludes** eval concerns, and `loadEvalRemarkTracks` (the read the EVAL
  surfaces consume) **keeps only** them. Splitting at the source — inside `mergedIssues` — frees every issue
  surface at once, by construction: the [[issues-view]] Issues page list, the [[dashboard-issues]] board issue
  badge, and the `spex issues` drain all stop counting eval remarks as issues, with no per-surface filter.
  The eval-remark tracks instead ride the EVAL side ([[evals-view]]): the [[evals-feed]] rows and the [[event-detail]] pane,
  through the M2 server overlay.

- **One overlay feeds both eval homes.** The (node, scenario)↔thread join is lifted server-side onto the
  reading itself: `evalTimeline` attaches the eval thread as `EvalEntry.thread`, so it is present on **every**
  eval home — the issues-page feed folds it in through the board, the session tab through the proof model.
  [[event-detail]] therefore reads its remark track from `entry.thread`, never from a resident issues list
  (which no longer holds eval threads anyway) — the counterpart to splitting them out.

Together these reach **U1**: ONE `EventDetail` component ([[event-detail]]), store-agnostic, reused in every
home — the issues eval tab AND the session eval tab (whose "no resident issues list" degradation is gone, since
the composer authors remarks through the CLI-parity `/api/remarks` and needs no list). **U2** holds
throughout: scenario and issue stay DISTINCT peer types on DISTINCT surfaces (Evals | Issues) — the split is
exactly what keeps them from collapsing into one super-type.
