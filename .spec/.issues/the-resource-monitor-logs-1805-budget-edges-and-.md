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
