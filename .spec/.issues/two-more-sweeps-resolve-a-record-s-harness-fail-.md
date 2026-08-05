---
concern: two more sweeps resolve a record's harness fail-loud, so one unresolvable record takes down the whole session list
by: 2c787e87-a0ad-4cae-b1db-aa2f1f922f19
status: open
nodes: harness-adapter, host-resource-budget
created: 2026-08-05T19:19:06.902Z
---

Spec: harness-adapter, host-resource-budget

Found while fixing `one-unrecognised-harness-id-blinds-host-resource` (landed on main as ee3f327be).
Same class, **larger blast radius**, and deliberately filed separately because my evidence here is a
static call-site reading, not a live outage.

## The two sites

Both resolve a record's harness with the fail-loud `harnessById` **inside a loop over records**, so one
unresolvable record aborts the whole sweep rather than one row:

- `spec-cli/src/sessions.ts:1049-1050` — the board projection. `paneActivity(harnessById(rec.harness || …))`
  and `const sessionHarness = harnessById(rec.harness || …)`, per record, while projecting every session row.
  A throw here does not degrade one row's activity headline; it takes down the **session list** — the primary
  product surface — for every session.
- `spec-cli/src/harness.ts:118` — `adapterLoadedReferenceState`, whose own header comment describes it as the
  one-call-per-adapter join over a record set. `harnessById(rec.harness || defaultHarness.id)` sits in that
  per-record loop.

## Why they did not fire tonight, and why that is not reassuring

The live `zcode` skew on `:8790` hit only the resource sampler because the sampler runs in the **supervisor**,
which never hot-reloads itself (`supervise.ts:18`). These two sites run in the **child**, which reloaded four
times and therefore resolves `zcode`. So tonight's specific skew is invisible here.

The two version-skew-free paths still reach them, unchanged:

- a record naming a harness whose plugin has since been removed;
- a record naming a harness id that was later renamed.

Session records outlive the config that created them, so an unresolvable `rec.harness` is a normal long-lived
state for any sweep over the record set.

## What is measured and what is not

Measured: the call sites, their enclosing loops, and that `harnessById` throws on an unknown id (its comment
says so, deliberately). Not measured: a live board outage from this cause. I did not manufacture one, because
the containment fix for the resource sweep was the filed defect and widening a commit into the board
projection would ship an unproven change to the product's primary read surface.

## Fix shape

Same as the one already landed for the host sweep, not a new idea: resolve through the nullable accessor
(`harnessByIdOrNull`, now in `harness.ts`) inside a sweep, and let the unresolvable row carry a finding/degraded
projection naming the unknown id instead of removing every other row. The general rule, which the landed fix's
spec body now states for the resource report:

> A fail-loud resolver is correct at a request boundary and wrong inside a sweep, because a sweep's inputs
> include rows nobody asked about.

The board's version of "one row degrades" needs its own decision (what an unresolvable harness's activity
headline and liveness should read as), which is why this is a separate issue and not a mechanical repeat.
