---
title: remark-teeth
status: active
hue: 205
desc: The teeth of the remark — an unresolved remark ages its scenario like a drift event (the 4th, non-git freshness axis), and clearing it needs BOTH a second-party resolve AND a fresh reading after that resolve. Plus the server-side overlay that lifts the (node,scenario)↔eval-thread join out of the dashboard: one join, keyed in trunk, overlaid read-time onto every surface.
code:
  - spec-yatsu/src/freshness.ts
  - spec-yatsu/src/freshness.test.ts
related:
  - spec-cli/src/issues.ts
  - spec-yatsu/src/evaltab.ts
  - spec-yatsu/src/proof.ts
  - spec-yatsu/src/cli.ts
  - spec-cli/src/board.ts
  - spec-dashboard/src/EventDetail.jsx
  - spec-dashboard/src/SessionEval.jsx
---
# remark-teeth

The [[remark-substrate]] built the substrate: a remark is a reply carrying a resolvable bit and the
codeSha it was authored against. This node gives that bit **teeth** — it makes an unresolved remark
actually *cost* something in the one loss signal the optimizer reads — and lifts the (node,scenario)↔eval
join **server-side** so every surface reads the SAME overlay.

## The teeth — the 4th, non-git freshness axis

Freshness was three git-derived axes (`code` | `scenario` | `evaluator`): a reading stales when a governed
file, the scenario's content, or the evaluator version moves past its codeSha. The remark adds a fourth
axis that is **not** git-derived — it is read from the trunk issue store's remark track:

> **clean ⟺ latest reading passes ∧ no code drift ∧ every remark resolved ∧ the latest reading post-dates
> the *resolution* of every remark.**

So a scenario is **`remark`-stale** whenever it carries a remark that is either (a) **unresolved**, or (b)
resolved but the reading does **not** post-date that resolution (`reading.ts ≤ resolvedAt`). Two things
follow, and they are the whole point:

- **You can't out-run a remark by re-running.** Filing a fresh eval *before* the resolve doesn't clear it —
  that reading pre-dates the resolution, so axis (b) still fires. The scenario stays stale until a reading
  taken *after* the resolve exists.
- **You can't clear it by passive receipt.** Resolve is a deliberate second-party call ([[remark-substrate]]'s
  R3: never the author — a governed session or the dashboard's human, monotonic), never a side effect of
  dispatch or delivery. Resolving
  *unlocks*; only the post-resolve reading *clears*.

This is one computation, fed at the call sites — `freshness.ts` stays a **pure** function: it takes the
scenario's remark track as an explicit parameter (`{resolved, resolvedAt}` signals) alongside the git
indices, never reaching into the issue store itself. Every surface that scores a reading passes the same track,
so the axis fires identically in `spex yatsu scan`, the eval tab, the board fold, the session proof, and
the dashboard score ring. The CLI is the whole model: `spex yatsu scan` shows the `remark` axis with no
server running.

## The server-side overlay — one join, keyed in trunk

The remark track lives **once in trunk**, keyed `(node, scenario)` by its `eval: <node> · <scenario>`
concern thread ([[remark-substrate]]'s R4). Reading it is a single function — `loadEvalRemarkTracks` — that
splits those eval-concern threads out of the issue store and hands back, per pair, the thread plus its remark
replies. That is the join the dashboard's `EventDetail.jsx` used to compute **client-side** (concern-key
matching against a resident issues list). Lifting it server-side means `buildSessionEvals`, the board fold,
the CLI, and the annotator all read **one** join instead of each re-deriving it.

The overlay is **read-time**, never a branch write: a human can remark an un-merged worktree eval and the
teeth fire the instant it is read, with nothing merged. A remark **pins its reading** (R2): the overlay
attaches it to the reading whose `codeSha` matches its `targetCodeSha`, or — when the target is dangling
(a since-superseded or renamed reading) — to the scenario's latest reading, so a dangling target never
*hides* the remark. The teeth themselves are independent of that display attachment: they read the whole
scenario track against the latest reading, so a remark whose exact target has scrolled out of history still
ages the scenario.

A remark whose scenario no longer exists (renamed/deleted) must stay **loadable**, never crash the fold —
its node-level surfacing is a later milestone, but the read never throws here.
