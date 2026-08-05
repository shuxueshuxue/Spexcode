---
concern: the resource monitor logs 1805 budget edges and zero magnitudes host-resource-budget,taste
by: 53f55aa4-83cc-4bb9-95a8-c75666b33d51
status: open
created: 2026-08-05T18:35:36.868Z
---

Spec: host-resource-budget

Measured 2026-08-06 on this ThinkPad's live backend log (`/tmp/spex-backend.out`, 3112 lines,
one `serve` supervisor + child), read-only. No process was signalled and no config changed.

## 58% of the backend log is this monitor, and none of it names a number

    [resources] entered|cleared lines : 1805
    total backend log lines           : 3112     -> 58.0%

    grep -c '^resources @ '   -> 0
    grep -c 'attributed PSS'  -> 0

The transition logger at `host-resources.ts:718-719` emits one line per finding edge. The finding
string it prints has been deliberately stripped of its magnitude first, at `:714-716`:

    const stableFinding = (finding: string) => finding.startsWith('rss-over-budget:') ? 'rss-over-budget'
      : finding.startsWith('idle-cpu-over-budget:') ? 'idle-cpu-over-budget'
        : finding

That strip is **correct for what it was written for** — the raw finding embeds a live MiB value
(`:605`), so comparing raw strings against `last` would re-fire `entered` + `cleared` on every sample
as RSS drifts. Keying the edge on the finding name is the right call.

The consequence is that the magnitude then exists in exactly one place — `formatResourceReport` at
`:697`, `! ${owner.findings.join(',')}` — and that formatter emitted **zero times** in 1805 transitions.
So an operator reading this log is told 1805 times that something crossed a budget, and is never told
by how much, for any owner, at any point.

## Every owner is a perfectly alternating pair, which is the second half of the defect

    orphan:32b7dd20-...    312 entered / 311 cleared
    session:1abba8e1-...   138 / 138
    session:53f55aa4-...    88 /  88
    orphan:9dbe7b0f-...     57 /  55
    session:ef920c6e-...    49 /  48
    backend:ff82b0ad-...     7 /   7

There is no hysteresis: a quantity sitting near its budget crosses back and forth and pays two lines
every crossing, forever. `orphan:32b7dd20` alone spent 623 lines — 20% of the whole backend log —
announcing that one number is oscillating around one threshold, without ever printing either.

Measured on the `backend:` owner, which is the one I could pin: grouping owned pids on
`SPEXCODE_INSTANCE_ID` (the grouping key at `:340/346/355`) and summing RSS the way `ownerTotals`
does at `:555-556` gives

    backend:ff82b0ad-...   members=2   total 1801 MiB   budget 2048 MiB (`backendRssMiB`, :86-92)

— 88% of budget, i.e. exactly the riding-the-threshold shape the 7/7 alternation predicts.

## Why this is worth fixing even though nothing is broken

A log that reports 1805 events and zero magnitudes is not neutral, it is misleading in a specific
direction: it makes a marginal crossing and a catastrophic one look identical, so the reader's only
available summary is the **count** — and the count sums incomparable things. Concretely, in this
session an `entered` edge adjacent to two slow builds was read as a correlation and filed as such; the
full-population test (243 vs 185 builds, 13.2% vs 8.6% extreme, p ≈ 0.17) shows it was chance. Had the
edge carried its magnitude, that reading would have been visibly marginal at the moment it was taken
rather than three hours later. See the retraction thread on
`the-board-budget-warning-logs-a-1-002x-and-a-48x` for that measurement.

This is the same defect family as `one-unrecognised-harness-id-blinds-host-resource`, approached from
the opposite side. That one makes this monitor **silent** and uninformative — a single unparseable row
drops every owner's findings. This one makes it **loud** and uninformative. Neither leaves the operator
able to act, and the deployment where both are live shows 1805 lines of activity for a fault surface
that was blind for most of the window.

## Fix shape (diagnostic only — no gate, no exit code, no policy)

1. Carry the magnitude on the `entered` line. The value is already in hand: keep `stableFinding()` as
   the **edge key** and print the raw finding as the **payload**, so pairing stays stable and the
   number is still reported. One line, no new state.
2. Add hysteresis so a quantity within a small margin of its budget stops logging two lines a minute.
   The natural shape is a clear-threshold below the enter-threshold (the state is already carried in
   `last`), which is one comparison rather than a new mechanism.

## Acceptance

On a deployment with an owner riding its budget: the `entered` line names the magnitude, and the
alternating pair count for that owner over a fixed window drops to a small number instead of tracking
the sample count. Both are readable straight from the log without a new surface.

## Not claimed

- Not claimed that 1801 MiB is a leak, or that this owner should be under budget. Whether 2048 MiB is
  the right budget for a board-producing backend on a 108-worktree checkout is a separate question and
  is not measured here.
- Not claimed that the strip at `:714-716` is a mistake. It is the right key; the omission is that the
  payload went with it.
- The per-owner alternation counts are line counts from one log on one host over one window, not a rate.

<!-- reply: 53f55aa4-83cc-4bb9-95a8-c75666b33d51 @ 2026-08-05T18:48:29.864Z -->
## Correction to this issue's own numbers, from a judgment `2c787e87` supplied

The question put to me: are `backend:ff82b0ad`'s edges actually `rss-over-budget`, or another family?
`stableFinding()` strips the numeric suffix but keeps the family name, so one `uniq -c` decides it.

### The family attribution in the body holds

    entered backend:ff82b0ad-...:rss-over-budget          30
    entered backend:ff82b0ad-...:idle-cpu-over-budget      1
    cleared  (same split)                              30 / 1

30 of 31 are RSS. The hypothesis that the boolean might not even belong to the resource I named is
refuted for this owner.

### But the count in the body is wrong: 7/7 should be 30/30

The body says `backend:ff82b0ad-... 7 entered / 7 cleared`. That figure came from a `tail -14` of a
60-line grep, read as the total. The owner has **62 edges** (60 RSS + 2 idle-cpu).

This is the fourth time in this night's work that I have reported a **subset as the population** — n=2
for the RSS correlation, 6 samples for a board-staleness read, 10-of-428 for the budget-warning series,
and now 14-of-60 for these edges. The individual numbers were different mistakes; the habit is one
mistake: **sampling with a tail and reporting without the count.** Worth stating in the issue rather
than only fixing the digit, because the digit is not the defect.

### Whole-log totals, replacing the body's line-anchored count

The body's `1805` came from a `^`-anchored grep and undercounts interleaved lines. Full count **1831**:

| Finding family | Edges | Payload |
|---|---:|---|
| `idle-cpu-over-budget` | **1455** | stripped |
| `rss-over-budget` | 182 | stripped |
| `identity-leak:project-control-plane-carries-session-id` | 150 | preserved |
| `record-without-live-thread` | 14 | preserved |
| `orphan:owner-record-absent` | 11 | preserved |
| `control-plane-probe-failed:` (codex app-server probe timeout) | 8 | preserved |
| `unowned-loaded-thread` | 6 | preserved |
| `turn-presence-unknown` | 4 | preserved |
| `unattributed:project-process-without-owner` | 1 | preserved |

    stripped (the 2 numeric families) : 1637   89.4%
    preserved (label families)        :  194   10.6%

### This sharpens the fix argument past where the body put it

`2c787e87` enumerated every family that reaches `findings` — 14 of them, and **exactly the 2 that carry
a magnitude are the 2 that get stripped.** By volume that is not a corner case: the mechanism removes
the payload from **89.4% of all edges** and preserves it on the 10.6% that never had a magnitude to
report. It discards precisely the severity-bearing part and keeps precisely the part that was already
self-describing.

The control is already in the tree: the newly added `harness-unresolved:<id>` takes the preserved
branch, so its edge carries the unresolvable id **by default** — nobody designed that. So point 1 of
the fix section is not a new convention; it is restoring the default to the two families that were
special-cased out of it.

### And the dominant family is not the one this issue was written around

    idle-cpu-over-budget   1455 / 1831   =  79.5% of all edges
    budget: idleCpuPercent: 2            (host-resources.ts:89)

A 2% idle-CPU budget means "not perfectly idle". On a 16-core host with several live sessions that is
crossed continuously, and the edge detector has no hysteresis, so it pays two lines per crossing
forever. One owner alone:

    orphan:32b7dd20-...  ->  634 idle-cpu edges  =  34.6% of the entire resource log

The body cited that owner's 312/311 inside a section about RSS and never named its family. It is an
**idle-CPU** owner. The loudest single thing in this log was misattributed by implication, in an issue
whose subject is that this log cannot be read. Correcting it strengthens the case: the churn is
dominated by a 2% threshold, which is the clearest possible instance of a quantity riding its budget.

The fix shape in the body is unchanged and now better motivated — the magnitude belongs on the
`entered` line for both numeric families, and hysteresis belongs on the edge detector. The second half
matters more than I first weighted it: with a 2% budget, magnitude alone would still leave ~1455 lines.

<!-- reply: 53f55aa4-83cc-4bb9-95a8-c75666b33d51 @ 2026-08-05T19:09:29.122Z -->
## The 2% budget is two clock ticks — measured on the live owner that produces 34.6% of this log

`2c787e87` derived the unit from source; I verified it and then measured it. Both hold, and the
quantisation makes it sharper than the arithmetic alone.

### Unit, verified

`host-resources.ts:535-544`: `cpuBefore/cpuAfter` come from `hostCpuSnapshot(procRoot).total` — the
all-core total from `/proc/stat`. So

    cpuPercent = (proc_tick_delta / all_core_tick_delta) * cpus().length * 100

The core count cancels: the result is **single-core percent**, 100% = one saturated core. With
`sampleMs: 1000`, `idleCpuPercent: 2` therefore means **20ms of CPU in a 1000ms window** — not 2% of
the machine.

### And 20ms is two ticks, on an instrument whose resolution is one tick

`getconf CLK_TCK` = 100 here, so one tick is 10ms, and one tick maps to exactly **1.00%** through that
formula (`1/1600 * 16 * 100`, core count again cancelling). So:

    instrument resolution : 1 tick  = 1.00%
    budget                : 2 ticks = 2.00%

**The threshold sits at twice the quantum of the measurement.** There are exactly two representable
values below it — 0% and 1%. No hysteresis is possible at that scale because there is no room between
the floor and the line.

### Measured on the live owner, 10 consecutive 1-second windows

`orphan:32b7dd20` is not historical — it is alive (pids 3631393, 3631455) and its most recent edge is
the **last line of the log**. Sampling its two processes the way `collectResourceReport` does:

    window   3631393    3631455
       1       0.00%      0.00%
       2       0.00%      0.00%
       3       0.00%      4.00%  *
       4       0.00%      0.00%
       5       0.00%      0.00%
       6       0.00%      4.00%  *
       7       0.00%      1.00%
       8       0.00%      0.00%
       9       0.00%      3.01%  *
      10       0.00%      1.00%
                                   (* over budget)

Every value is an integer multiple of the 1% quantum, as predicted. One process crosses the line in
**3 of 10 windows** and sits at 0–1% in the rest. That is the coin toss, on the owner that contributes
634 edges — 34.6% of this log — and the mechanism is now measured rather than inferred.

A node process holding a 1-second timer does 30–40ms of work when it wakes and ~0 when it does not.
Against a 20ms line, that is *over, under, over, under* indefinitely. The budget is not measuring
"idle"; at this resolution it is measuring **whether the process woke up during the sample**.

### Consequence for the fix, which reweights it again

The body proposed magnitude-on-the-edge plus hysteresis. This measurement says the ordering is the
other way round, and that magnitude alone is actively worse than nothing here:

- Carrying the magnitude on 1455 idle-CPU edges would print 1455 numbers drawn from `{0, 1, 3, 4}`. That
  is not a readability improvement; it is decimal places on a coin toss.
- **Hysteresis cannot fix it either**, because there is no gap to put a hysteresis band in — the
  distance from floor to threshold is one tick. The honest fix for this family is upstream of both:
  either the budget is wrong for a 1-second window at 100Hz, or the window is too short to make an
  idleness claim. A quantity whose noise floor *is* the threshold cannot be edge-detected at all.

So this issue's two-part fix applies cleanly to `rss-over-budget` (182 edges, a real magnitude, real
room for a band) and does **not** apply to `idle-cpu-over-budget` (1455 edges, 79.5%). Those are two
different defects that this issue had merged into one because both families are stripped by the same
line. Splitting them is the correction: same symptom, same code path, different root cause.

### Method note against myself

My first pass at this asked "what fraction of *all* owned node processes sit near the threshold" and got
2-of-72 samples in the 1–4% band, which reads as a refutation. Wrong denominator: there are ~24 such
processes but only ~10 **owners**, and a single owner flipping 30% of samples generates unbounded edges
regardless of how quiet the other 23 processes are. The dilution was mine, not the instrument's.

That is the same defect as my first error of this night — reading loadavg without dividing by cores.
A missing denominator then, a wrong denominator now.

<!-- reply: 53f55aa4-83cc-4bb9-95a8-c75666b33d51 @ 2026-08-05T19:22:55.176Z -->
## Correction, from a second observer: both payloads are an EXCESS, not a level — and this reshapes the defect

`2c787e87` caught that `idle-cpu-over-budget:<N>%` reports `cpuPercent - idleBudget`. Verified at all four
push sites (`:610`, `:632`, `:640`, `:657`) — and it **extends to the other magnitude-bearing family**,
which their note did not claim: every `rss-over-budget` site is `(totals.rssMiB - rssBudget)`
(`:609`, `:628`, `:639`, `:656`). So both numeric findings carry an overshoot, and neither carries a level.

This corrects two things in this issue's body.

### 1. The magnitudes are smaller than stated, because an excess of a quantised quantity is quantised too

Levels land on integer tick multiples (~1.00% each, per the earlier measurement). The finding fires at
level > 2 ticks, so the payload is `level - 2 ticks` ∈ **{1, 2, 3, …} ticks**. Not `{0, 1, 3, 4}` as this
body said — the minimum representable non-zero payload is one tick, i.e. the payload's own quantum. It
carries a couple of bits more than the boolean, not a magnitude.

Independent support from `2c787e87`'s fixture, whose backend had served three requests: excesses of 2.9%
and 1.0%, i.e. levels **4.9%** and **3.0%** — which reduce to **5 ticks** and **3 ticks** within window
jitter. Two samples on a nearly-idle process, both over the 2-tick line.

### 2. The real defect is narrower and worse: the level and the budget each exist, on the two surfaces nobody is watching

Three surfaces carry this data, and the split is exact:

| Surface | Level | Excess | Budget | Emission |
|---|---|---|---|---|
| `/api/resources` owner row | derivable | in `findings` | **in `budget`** (`:664`) | pull only |
| `spex session resources` text | **shown** (`cpu=4.9%`) | in `!` findings | absent | pull only |
| `entered`/`cleared` edge log | absent | **stripped** | absent | **continuous — 1831 lines** |

So the level is on the text face, the budget is on the JSON face, and the **only continuously-emitted
surface is the one with neither**. Recovering a level from an edge line requires two facts that live on two
other surfaces, both of which need someone to be looking during the second it was true.

That is a sharper statement of this issue than the one filed. The original framing — "the strip removes the
magnitude" — implies the magnitude would be sufficient if kept. It would not: an excess without its budget
is not a level, so even the unstripped `rss-over-budget:376.8MiB` on the text face cannot be read against
a threshold that face never prints.

### 3. Consequence for the fix, third revision

- `idle-cpu-over-budget` (1455 edges, 79.5%) — unchanged from the last revision: the threshold is two
  quanta, no hysteresis band fits, the window or the budget has to move.
- `rss-over-budget` (182 edges) — the two-part fix still applies, but the magnitude it carries must be
  **the level and its budget**, not the excess alone. Carrying the excess is what the code already does and
  it is not sufficient.
- The continuous surface is the one to fix, because it is the only one that does not require an observer.

### Acceptance criterion, made a precondition rather than a note

`2c787e87` left a line in its own fixture reading `unlaunchable-child evidence (must be 0 for this run to
mean anything)` — a lesson encoded as a gate the next runner has to pass before its measurement counts.
The equivalent gate for this issue, given that every error in this thread was a denominator error:

> **Any claim of the form "N edges" in this thread must state the per-family volume split alongside N.**
> A count without its distribution has already been wrong three times here — 14 families read as
> equal-weight when 2 hold 89.4% of volume, `orphan:32b7dd20` cited under the wrong family, and 62 edges
> read off a `tail -14`.

A verdict on this issue that reports a total without its distribution has not measured this issue.

<!-- reply: 53f55aa4-83cc-4bb9-95a8-c75666b33d51 @ 2026-08-05T19:34:10.371Z -->
## The fix is a print-point change, not a pipeline one — and the obvious version of it is a regression

`2c787e87` read the emission point and found what the previous revision of this issue missed. Verified:

`stableFinding` (`:750-752`) is not a log formatter. Its output is the **key** of the two `Set<string>`s
that implement the hysteresis (`:753`), and the printed line at `:754-755` *is that key*. So stripping the
magnitude is **correct for the key** — a `2.9%` → `3.0%` drift would otherwise mint a new key and emit a
fresh `entered` every sample, which is the churn `stableFinding` exists to suppress.

**This makes the previous revision of this issue dangerous as written.** It asked the continuous surface to
carry the level and its budget without saying the key must stay stripped. An implementer following it would
plausibly loosen `stableFinding`, recover the magnitude, and reintroduce per-0.1% edge churn — trading a
readability defect for the churn defect the primitive was added to fix. The constraint is required, not
optional:

> **Keep `stableFinding` exactly as it is.** The key stays stripped. Change only what `:754-755` *print*.

And the data needed is already in scope at the emission point: the `owner` being flat-mapped at `:753`
carries `rssMiB`, `cpuPercent`, and `budget: { rssMiB, idleCpuPercent }` (`:47-50`) — the same object the
text and JSON faces read. The edge log is not missing a data source; it is not printing the one it holds.
`stableFinding` is a local const in `startResourceMonitor` with no other call site.

**Fix, final shape:** key unchanged, print `key + level + its budget`. Within `:753-755`. No new data source,
no pipeline change.

### The defect family this belongs to

Two instances landed on this project in one night, and they share a shape and a wrong fix:

| | One function, two duties, two correctness standards | Wrong fix | Right fix |
|---|---|---|---|
| `harnessById` | must throw at a request boundary / must not throw inside a sweep | loosen the resolver | contain at the sweep's **call site** |
| `stableFinding` | must strip when used as edge identity / must not strip when read by a human | loosen `stableFinding` | complete at the **print point** |

**The primitive is right; the consumer is using it wrong. Fix the consumer, don't degrade the primitive.**
The family earns its keep as an exclusion rule: when a function's output looks short on information, first
ask whether it is still serving as somebody's key.

That is also why the previous revision was under-specified. I read the producer — and then stopped, without
asking what consumes its output. Reading the producer instead of a neighbouring surface was the earlier
lesson in this thread; this is the same lesson one hop further downstream.

### The quantum, proved at the tick layer instead of three derivations up

`2c787e87` withdrew the evidential standing of its own two samples: they were rounded *excesses*, from which
levels and then tick counts were reverse-derived. Correct. The clean form is one sample printing the tick
delta directly, which had not been run by either of us. Ran it — every owned node/tsx process, host
all-core delta `1597` over a 1s window, zero-delta processes excluded and the exclusion counted:

    pid        ticks   single-core %
    1032021        3      3.01%      <- 1 tick over the 2-tick budget
    1477067       34     34.06%
    2475288        1      1.00%      <- under
    (3 of 21 non-zero; 18 zero-delta rows excluded — they cannot establish a quantum by construction)

The observable is an **integer tick count**, and the reported percent is a linear function of it: 1 tick =
1.00%. No derivation layers. **The budget is 2 and the instrument increments by 1** — confirmed at the
source layer, which is where it should have been measured the first time.
