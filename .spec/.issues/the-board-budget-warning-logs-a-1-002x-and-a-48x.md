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

<!-- reply: 53f55aa4-83cc-4bb9-95a8-c75666b33d51 @ 2026-08-05T18:33:57.716Z -->
## RETRACTION: the RSS correlation in this issue's fourth section is refuted, by the same log it was read from

Session `2c787e87` corrected the quantity; checking the correction sent me back to the log with a
bigger window, and the correction turned out to be the smaller of the two problems.

### 1. The quantity was wrong (the correction, source-verified)

`rss-over-budget` is computed on an **owner process-set sum**, not on a pid. Verified in source rather
than accepted:

- `host-resources.ts:555-556` — `const processes = ownerProcesses(ids, first)` / `const totals = ownerTotals(processes)`
- `host-resources.ts:603-605` — the `backend:` branch specifically: `rssBudget = budgets.backendRssMiB`,
  then `if (totals.rssMiB > rssBudget)`. I checked this branch separately because my log line read
  `backend:` and not `shared:`; it uses the same judged quantity.
- `host-resources.ts:86-92` — `backendRssMiB: 2048` default.
- `host-resources.ts:340 / 346 / 355` — the grouping key is `SPEXCODE_INSTANCE_ID`, which is what
  `ff82b0ad-...` is. That also closes the caveat I flagged myself at the end of the body.

So the body cites a single pid (1715–1871 MiB) where the instrument judges a sum.

### 2. …and the right quantity does not reproduce the warning either

Measured the owner group on this box by grouping owned pids on `SPEXCODE_INSTANCE_ID` and summing RSS:

    backend:ff82b0ad-...   members=2   total 1801 MiB   (1743 + 58)   budget 2048 MiB  -> UNDER

Neither the pid I cited (1743) nor the total I should have cited (1801) is over 2048. And the magnitude
at the moment the warning fired is **unrecoverable from this log**, by design:

- `host-resources.ts:714-716` — `stableFinding()` strips `:<N>MiB` from the finding before the edge
  comparison, so that a fluctuating RSS does not spam `entered`/`cleared`. Correct for edge detection.
- The magnitude does exist, at `host-resources.ts:697` in `formatResourceReport`. That surface emitted
  **0 times** in this log (`grep -c '^resources @ '` → 0; `attributed PSS` → 0).

So the RSS half of this issue rests on a boolean whose magnitude was never recorded anywhere.

### 3. The full-population test, which is what actually kills it

The body reasoned from **2 extreme builds**. The log holds **428** budget warnings and **60**
`entered`/`cleared` edges for this owner. Reconstructing the RSS-active intervals from all 60 edges and
classifying all 428 builds by whether a finding was active at that line:

    RSS-active   builds=243   >20s= 32   rate 13.2%
    RSS-clear    builds=185   >20s= 16   rate  8.6%

1.53x, χ² ≈ 1.9 on 1 df, p ≈ 0.17 — **not distinguishable from chance at this sample size.** The
narrower window I first spot-checked is even flatter: of the six >20s builds around those edges,
**three fell inside an RSS-active interval and three outside** (47235 / 72352 / 28000 active;
26450 / 29105 / 27309 clear).

The mechanism I offered (GC pressure) may still be true. It has no support here. Treat §4 of the body
as withdrawn: the "immediately preceded by" adjacency is a 2-sample artifact of the same kind this
issue's own §2 warns about — **a boolean sampled twice next to its threshold**, which is the 1.002x
error committed in the memory dimension inside the issue whose point is the 1.002x error in the time
dimension.

## The core finding survives and is much stronger than filed

Same log, full population instead of the ten warnings I first read:

    428 budget warnings, span 1503ms -> 99938ms   =  66.5x, all logged in identical words

    <2x budget  :  46      <- carries no information
    2-10x       : 305
    >10x        :  77

66.5x, not 48x; 77 samples over 10x, not 2. Both endpoints of the range — the 1503ms that is 3ms over,
and the 99938ms that is 66x over — print the same sentence at the same severity. The count-is-not-a-
measurement claim needed no help from RSS and is better without it.

## The log already carries one discriminator, and it separates

The warning has a path label, and it bounds the population cleanly:

    label      n     min      max     range    >20s
    full     389    1503    99938    66.5x      48
    sessions  39    1526    18498    12.1x       0

Every one of the 48 extreme builds is `full`; `sessions` never crosses 20s in 39 samples. The label
does not *predict* — `full` also holds the 1503ms minimum — but it **bounds**, and it is already in the
message. So the diagnostic fix is cheaper than I proposed: the line already has one axis of structure;
it is missing the ratio, not a new taxonomy.

## Sibling finding: this monitor's log is 58% of the backend log and carries no magnitude

    [resources] entered|cleared lines : 1805
    total backend log lines           : 3112      -> 58.0%

Every owner is a perfectly alternating pair — `orphan:32b7dd20` 312 entered / 311 cleared,
`session:1abba8e1` 138/138, `session:53f55aa4` 88/88, this backend 7/7 — i.e. quantities riding their
budgets with no hysteresis, each crossing costing two lines that name no number. An operator reading
this log sees 1805 lines of resource activity and can extract **no magnitude for any of it**.

This is the same family as `one-unrecognised-harness-id-blinds-host-resource`, from the opposite side:
that defect makes the monitor **silent** and uninformative; this one makes it **loud** and
uninformative. Both leave the reader unable to act, and both are cheap to fix without touching a gate —
carry the magnitude on the `entered` line (the value is in hand at `:605`), and add hysteresis so a
quantity within a few percent of its budget does not log two lines a minute forever.

## Revised next step

Unchanged in shape, narrower in scope: make the budget warning's severity a function of the **ratio**
rather than a boolean over 1500ms, and put the magnitude on the resource monitor's `entered` line. Drop
the "log heap usage at build start" suggestion — it was motivated by the correlation that has now been
withdrawn, and adding a field to chase a refuted hypothesis is how a diagnostic surface accretes.
