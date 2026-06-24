# Grounding mechanism — yatsu measurement (real agents)

Brutal, behavior-level measurement of the spec-grounding mechanism (the `spec-first` read-time nudge,
the `spec-of-file` per-edit annotation, and the spec-pointer prompt injection). "yatsu" here = run a real
agent on a real task and score what it actually *did*, not what it claims.

## Method

A controlled task whose **spec carries non-obvious intent** so grounding is measurable, not subjective:

- Node `widget` governs `widget.js`; its spec says prices are **EU-only — `9,99 €`, comma decimal, € after
  the amount; a `$`/dot format is a correctness BUG.** None of this is visible in the bare code stub.
- **Edit task:** "implement `formatPrice(amount)`." A grounded agent reads the spec → ships `9,99 €`
  (HONOR). An ungrounded agent defaults to `$9.99` (VIOLATE).
- **Scoring is behavioral, not textual:** each run's `formatPrice(9.99)` is *executed* and the returned
  string classified. (An earlier text-grep scorer was thrown out — it scored explanatory comments
  mentioning `$` as violations. Brutal lesson: measure behavior, not prose.)
- Conditions vary the **prompting strategy** and **hook**: `blind` (nothing), `contract` (prose "read your
  spec first", no path), `pointer` (spec *path* in prompt), `hookonly` (read-time `spec-first` hook, no
  pointer), `full` (pointer + hook + annotate + contract). Isolated git repos, `claude -p`, stream-json
  traces. Same task on **Opus 4.8** and **Haiku 4.5**.

## Results

**Edit task — does the output honor the spec?**

| condition | Haiku 4.5 | Opus 4.8 |
|---|---|---|
| blind (no path, no hook) | **VIOLATE 3/3** (`$9.99`) | HONOR (self-grounded) |
| contract prose only (no path) | **VIOLATE 3/3** (`$9.99`) | — |
| pointer (spec path in prompt) | HONOR 2/2 | HONOR |
| hook only (read-time, no path) | HONOR 3/3 (block fired) | HONOR |
| full | HONOR 2/2 | HONOR |

**Analysis task (read-only) — does grounding get *enforced*?**

| hook | block fired | meaning |
|---|---|---|
| mutate-only (old) | **0/3** | structurally blind: never fires on a read-only task |
| read-time (new) | **3/3** | fires on the first code read — the gap this change closes |

## Findings (brutal)

1. **Strong models self-ground; the mechanism is a reliability floor for them, not a quality boost.**
   Opus 4.8 honored the spec in *every* condition including blind — it explored, found `.spec/`, read the
   spec unprompted (`CODE>SPEC>CODE`). On Opus the hooks change grounding *order*, not output.

2. **Weak/fast models do NOT self-ground — and the mechanism is the difference between a correct and a
   broken result.** Haiku blind ships `$9.99` and never opens the spec (`CODE>CODE`), violating a contract
   it never read. Path delivery flips it to `9,99 €`.

3. **Paths beat prose — decisively.** The prose contract *"read your node's spec first"* with **no concrete
   path** did *nothing*: VIOLATE 3/3, identical to blind. What works is delivering the **spec path** —
   either via the prompt pointer or via the hook's block message (which resolves and includes the path).
   An exhortation a weak agent can't act on is theater; a path it can open is leverage.

4. **The read-time widening is validated where it matters.** On read-only/analysis work the old mutate-only
   hook is structurally blind (0/3 fire) — exactly the gap that let an analysis session reason straight
   from code without ever opening its contract. The read-time hook enforces grounding there (3/3 fire).

## What works elegantly (the promising configuration)

- **Spec POINTER (path in the prompt)** — cheapest, non-blocking, yields spec-first ordering and HONOR on
  weak models. The primary lever.
- **Read-time `spec-first` HOOK** — the *guarantee/floor*: delivers the path and enforces grounding even
  when there is no pointer or the agent would skip it, and (unlike mutate-only) covers read-only work.
- **`spec-of-file` annotation** — same principle applied at the edit: deliver the concrete owner, not a
  lecture. Consistent with finding #3.
- **Downweight prose exhortation.** "Read your spec" with no path earns nothing. Every grounding surface
  should hand over a path / owner, not an instruction. This is a direct design rule for lint/drift messages
  too: name the file and the node, don't moralize.

## Caveats (don't oversell)

- Small n (2–3 reps/cell); one synthetic task; one repo. The *direction* is clean (binary, unanimous per
  cell) but effect sizes aren't.
- "blind" still had a discoverable `.spec/` — Opus's self-grounding may not survive a less discoverable
  layout, and Haiku's blind violation might worsen (it never looked at all).
- Read-only enforcement: Haiku read the spec anyway in `mutate-only` (it explored), so the *behavioral*
  delta there was small even though the *enforcement guarantee* (block fired) differs cleanly.
- Backend nodes (`spec-first.sh`) can't use formal frontend yatsu; this is an ad-hoc but real measurement.

## Bottom line

The grounding mechanism earns its place — but its value is **conditional and concrete**: it prevents real
spec violations on models that don't self-ground, and it does so by **delivering the spec path**, not by
exhorting. Prose is the weak link; path/owner delivery (pointer, hook block, annotation) is the lever. The
read-time widening closes a real, structural gap for analysis work. Harness + raw traces:
`scratchpad/exp/` (not committed — regenerate via `run_exp.sh`).
