---
title: human-ok
status: active
hue: 140
desc: The human sign-off on an eval — a monotonic, append-only 'human-ok' event binding ONE immutable eval (the scenario's latest at ok-time); the evals feed default-hides a fresh, ok'd scenario until a newer eval or live staleness releases it. CLI `spex eval ok` and the dashboard's typed /ok share one server write; on the trunk checkout it commits straight to trunk under the local-issues discipline.
code:
  - spec-eval/src/humanok.ts#fileHumanOk
related:
  - spec-eval/src/sidecar.ts
  - spec-eval/src/evaltab.ts
  - spec-eval/src/cli.ts
  - spec-cli/src/localIssues.ts
  - spec-cli/src/index.ts
  - spec-dashboard/src/EvalsFeed.jsx
  - spec-dashboard/src/EventDetail.jsx
---
# human-ok

## raw source

A human who reviewed an eval and agrees with its verdict marks it **human-ok** — the one thing the
loss signal cannot record itself: a human looked and concurred. The review surface then stops
re-presenting what is already reviewed.

## expanded spec

**The ok binds to ONE immutable eval.** Its target is the scenario's latest effective eval at
ok-time, anchored by that eval's ts (the natural key a retraction also joins by) plus its codeSha
for the human reviewer. Because evals are append-only, the ok is **monotonic — no un-ok verb exists**:
a newer eval is a *different object* the ok never transfers to, and staleness is computed live, so
both release conditions fire automatically with no second write. Blessing an unmeasured (or
fully-retracted) scenario is refused — there is nothing to agree with; a duplicate ok is idempotent
success, never a second row.

**Storage is an appended event in the node's evals.ndjson** — kind `human-ok`, scenario, the anchor to
the eval it marks ok, the by-identity, ts — through the same append-only surface every other sidecar
event uses; no existing row is ever mutated. Event kinds stay **positively discriminated** (an eval by
its codeSha, a retraction by its retracts, an ok by its kind), and an ok line carries no top-level
codeSha, so a pre-human-ok toolchain skips it silently instead of mistaking it for an eval. The ok is
deliberately **not routed through the remark thread**: a remark's semantic is aging pressure — an open
concern that stales the scenario — and the sign-off is its opposite (settled agreement); overloading one
substrate with both would make the teeth ambiguous.

**Feed semantics — triage, never erasure.** The evals feed default-HIDES a scenario whose latest
eval is **fresh AND human-ok'd**: that row is reviewed loss, not current loss. It reappears the
moment a newer eval lands (the ok doesn't transfer) or the eval goes stale (freshness is live).
The hide is **feed-level only** — node detail, the A/B strip, and the per-scenario history still show
everything — and the feed's head carries a show-all chip (the live-chip grammar: self-hides at zero
only while off), so ok'd entries stay one click away, never invisible-forever. A deep-linked eval the
hide would conceal releases it, exactly like the kind/live filters. In the feed, a settled sign-off is
the dashboard's shared stroke check inside a quiet green certification ring — never a platform-dependent
Unicode checkbox — and the reveal chip uses the same glyph. Feed rows are STATUS-ONLY: they never offer
the write before sign-off, because human-ok certifies that the eval's evidence was actually reviewed.

**One write, CLI parity (LAW L).** The verb is `spex eval ok <node> --scenario <s>`; the dashboard's ONE
door is the event-detail composer's typed **`/ok`** ([[review-commands]]) — offered only while the viewed
eval IS the scenario's latest and not yet ok'd (older A/B poles are history) — calling the same runner
and server route, whose identity is **server-derived `human`**, never the request body. The header carries
no write button, only the settled ok'd mark once the sign-off lands: the review track's typed grammar is
the sign-off's whole dashboard surface. A **governed session is refused the CLI verb**:
an agent blessing an eval would hide it from exactly the review the ok certifies — the no-self-resolve
analogue; an agent's judgment on an eval is a remark. No review-track dropdown or queue here — a
separate future lane.

**Where the write lands durably — the local-issues discipline, adapted.** A human click has no worktree
and no commit ritual behind it, and the sidecar is git-tracked: a bare append on the live main would sit
as permanent working-tree dirt no one owns. So the write reuses the trunk-commit discipline the local
issue store proved (its committing half is exported for exactly this): on the **trunk checkout** — the
primary backend, a human's terminal on main, a throwaway clone owning its own main — the append is
committed **straight to trunk, `--no-verify`, provably scoped to the one sidecar path, under the shared
store lock** that serializes every trunk data write against the git index. The one place this diverges
from the issue store is deliberate: the sidecar, unlike the issue store, **legitimately lives
per-branch and merges**, so a linked-worktree checkout is not refused — its append simply stays
uncommitted in that tree, and the session's own ritual commit carries it, exactly like every other
sidecar write (the CLI says which landing happened). Freshness, lint, and the teeth are untouched — the
ok is a review overlay on the scoreboard, never a fifth freshness axis.
