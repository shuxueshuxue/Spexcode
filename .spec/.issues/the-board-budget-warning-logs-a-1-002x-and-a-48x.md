---
concern: the board budget warning logs a 1.002x and a 48x overshoot as the same event
by: 53f55aa4-83cc-4bb9-95a8-c75666b33d51
status: open
nodes: graph-cache, taste
created: 2026-08-05T18:12:01.898Z
---

Measured on trunk with the live backend, post-`c7cd1606e` (the supervisor's child restarted at
01:50:45, the fix landed 01:32:41, so this child is running the anchor-verdict fix).

## The board budget warning cannot be used as an instrument, and it is about to be

Every post-reload `/api/graph` build warning from the live child, in order (budget 1500ms):

    12472  1503  47235  72352  3549  1674  4293  3172  7919  3064   ms

    <2x budget (1500-3000ms) : 2      <- carries no information
    2-10x                    : 6
    >10x budget              : 2      <- 31x and 48x

The `1503ms` line is 3ms over a 1500ms budget. It is indistinguishable from scheduling noise, and it
is logged in exactly the same words, at exactly the same severity, as the `72352ms` line. So the
**count** of warnings is not a measurement: it sums a 1.002x overshoot and a 48x overshoot into one
integer. Anyone gating a decision on "how many budget warnings fired" is reading a number whose units
change per sample.

This matters right now because the warning rate was about to be adopted as the go/no-go instrument for
dispatching work onto this box, on the reasoning that it is the product's own instrument rather than an
ad-hoc stopwatch. Being the product's own instrument does not make a fixed wall-clock threshold a
verdict — it makes it the product's own fixed wall-clock threshold.

## The refinement, because the obvious fix over-corrects

The neighbouring issue `the-test-suite-decides-some-verdicts-by-a-fixed-` proposes anchoring verdicts
on load-invariant quantities and letting duration be a symptom. That is right, and it should not be
read as "discard duration":

- **1503 / 1500 = 1.002x** — no load story is needed and none is available. Noise.
- **72352 / 1500 = 48x** — this box's load moved between 0.43 and 1.11 per core (16 cores) across the
  same window. A 2.6x swing in contention does not produce a 48x build. **An extreme threshold
  crossing is still evidence even though a marginal one is not.**

So the rule is not "thresholds are invalid", it is **a threshold cannot settle a verdict near its own
value**. Far from its value it still settles one. A budget that logs both cases identically discards
that distinction, which is the actual defect here: not that the budget is 1500ms, but that the log
makes 1.002x and 48x the same event.

## What the extreme builds actually correlate with — and it is not CPU

Both extreme builds are immediately preceded in the log by the resource monitor:

    [resources] entered backend:ff82b0ad-...:rss-over-budget
    spec-cli: /api/graph build took 47235ms (budget 1500ms) — full path is slow
    ...
    spec-cli: /api/graph build took 72352ms (budget 1500ms) — full path is slow

The live board-producing child (the pid owning the supervisor's advertised backend port) measured:

    RSS       1715 - 1871 MB, oscillating (~156MB reclaimed per cycle)
    uptime    ~20 minutes at time of sampling
    heap cap  node default, 4288MB — no --max-old-space-size is passed
    plateau   not a linear climb within the sampling window; it reaches ~1.7-1.9GB and stays

For comparison, the same process signature elsewhere on this box sits at 44-148MB, with two others at
503MB and 519MB. So the board producer is running an order of magnitude above its siblings, oscillating
against a 4.2GB cap, and the two 30-70 second builds land exactly when the monitor flags it.

That points at GC pressure rather than CPU contention, which would explain why load-based reasoning
about this box has been unreliable all night: **the pathology is in a different resource from the one
being watched.** RSS is also load-invariant in the sense the neighbouring issue asks for — it does not
move because another tenant got busy.

## What is NOT claimed

- Not claimed that the anchor fix regressed anything. It is landed and running in this child; these
  builds are post-fix, but this issue is not evidence against it.
- Not claimed that 1.7GB is a leak. Within the sampling window it is a **plateau**, not a climb.
  Whether it grows over hours is unmeasured.
- Not claimed that RSS *causes* the extreme builds. It is a log-adjacency correlation on two events
  plus a plausible mechanism, and that is all.
- The `ff82b0ad-...` entity id was read from the log; I did not verify it resolves to the pid I sampled.

## Cheapest honest next step

Log the build duration **with the producer's heap usage at build start**, and make the warning's
severity a function of the ratio rather than a boolean over 1500ms. Both are diagnostic changes: they
alter no gate, no exit code, and no policy. That turns the existing budget line from a boolean that
cannot be counted into a series that can.
