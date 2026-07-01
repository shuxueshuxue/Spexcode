# video-yatsu — realizability proof

A proof that the mechanism **M** specified by [[video-yatsu]] + its children is *fully realizable* inside
SpexCode's existing yatsu model: every capability the concrete use case demands maps to a concrete
primitive, no primitive breaks a yatsu invariant, nothing depends on a particular test framework, and the
dispute-lock is a sound, deadlock-free, *binding* function of the append-only log. This is design evidence,
not a spec body. §6 records the amendments three adversarial verifiers forced.

## 0. The concrete use case (what M must fully support)

- **U1** Tech stack: Playwright + a recorded video + a rich-interaction annotator.
- **U2a** After annotating, the tool locates, from the annotation's timestamp, *which step* it lands on.
- **U2b** The annotation is *feedback to the agent*: a human evaluates the agent's evaluation of the code
  (an evaluator's evaluation). The agent gives `pass|fail`; the human annotates alongside; the evaluation
  then enters a state that *needs revision*, and until that revision is completed the agent **cannot** open
  a new evaluation for that scenario.

## 1. Primitives of M

- **P1 `video` blobKind** — a reading's evidence may be video bytes, content-addressed, shared cache.
- **P2 step-timeline** — a companion content-addressed blob per reading: ordered `{tMs, step, kind}` with a
  boundary planted at t=0, aligned to the clip's first frame.
- **P3 emitters** — a userland `start / mark / flush` helper stamping `mark` against the recorder clock;
  Playwright reporter, WebDriver listener, computer-use/human narration are instances. SpexCode ships the
  *format* (P2) and at most one reference helper.
- **P4 event log** — append-only ndjson, a **discriminated union** of two line kinds: a `reading`
  `(scenario, codeSha, blob, blobKind, +timelineBlob?, evaluator, verdict{pass|fail,note?}, ts, +resolves?)`
  and a `dispute` `(kind:dispute, scenario, targetTs, blob, note, ts)`. Reading-only consumers (freshness,
  latest-per-scenario) filter to readings; the lock consumer reads both. Content-addressing lets lines
  share a blob.
- **P5 annotator surface** — a dashboard Eval-tab reader of `{video blob, timeline blob, scenario.expected}`
  that lets a human scrub / circle / comment and, on save, files a normal reading or a `dispute` through the
  eval seam. It executes no test.
- **P6 evaluator tag** — `name@version` metadata recording *who* measured.
- **P7 dispute lifecycle** — a `dispute` line; a **lock** derived live: S is *locked* iff **some** dispute
  on S has no later reading carrying `resolves: <that dispute>` (every open dispute counts, not just the
  latest); a **gate** at `spex yatsu eval` + the stop-gate that, on a locked S, refuses a new reading unless
  it carries `resolves` **and is non-trivial** — the resolving reading must advance `codeSha` or carry an
  evidence blob distinct from the disputed reading's. The `disputed` marker feeds only this gate; loss
  aggregation never reads it.

## 2. The invariants M must preserve

- **I1 yatsu runs nothing** — the engine records measurements and refuses actions; it never drives a
  browser, runs a test, or executes an evaluator; dispatch of a revision is the *session* engine, not yatsu.
- **I2 git is the database** — state is an append-only log; every derived signal (freshness, the lock) is a
  pure function of that log; no stored mutable status, no stored hashes.
- **I3 the natural-language scenario is the loss** — the prose scenario is the target; the verdict is the
  agent's single `pass|fail` bit; the `disputed` marker is gate-only and invisible to loss aggregation, so
  it is not a second verdict axis.

## 3. Theorem

**M is fully realizable**: (C) *coverage* — ∀ capability in {U1,U2a,U2b} ∃ a primitive realizing it;
(V) *invariant-preservation* — every primitive respects I1,I2,I3; (G) *genericity* — no primitive depends
on Playwright; (S) *soundness* — the P7 lock is a total, well-founded, deadlock-free **and binding**
function of the log.

## 4. Proof

### 4.1 Coverage (C)

- **U1 → P1+P3+P5.** Playwright is one P3 emitter. The clip is stored via P1; the rich annotator is P5.
  Every gugu annotator capability (region-circle coords, multi-frame linkage, per-step comment) is authored
  payload in an unbounded export blob; step-anchoring needs only P2 point lookup (a range = two lookups),
  so annotation richness is orthogonal to the thin timeline. ∎
- **U2a → P2.** Because the emitter plants a boundary at t=0 (P2), the step at any moment T≥0 is the last
  boundary with `tMs ≤ T` — always defined, total, exact. (This closes the pre-first-boundary hole the
  first draft clamped by fiat; see §6-A3.) ∎
- **U2b → P4+P5+P7.** The agent's `pass|fail` is an ordinary reading (verdict untouched — I3 intact). The
  human's annotation is a P7 `dispute` filed via P5, *not* a competing verdict — so the human never picks a
  bit that means two things. The dispute locks S ("needs revision before a new evaluation may open" — U2b's
  state, realized). "Hand it to another agent" is dispatch: the annotation blob becomes a task; the
  dispatched agent files the non-trivial `resolves` revision, clearing that dispute. ∎

### 4.2 Invariant-preservation (V)

- **I1.** P1 stores bytes someone else recorded; P2 stores an emitter's file; P5 annotates an
  already-captured clip (annotating ≠ executing the measurement); P7's gate *refuses* an action — a
  predicate check, not execution. Revision dispatch is the session engine (`spex new`), not the yatsu seam.
  No primitive runs a recorder or test. ∎
- **I2.** Reading, dispute, and revision are all append-only lines of one discriminated union; the lock is a
  pure predicate over that log (latest dispute-vs-`resolves` pairing), computed as freshness is, with no
  stored status. Reading-only consumers filter dispute lines, so freshness/latest are unperturbed.
  Content-addressed evidence stays in the shared common-dir cache, uncommitted. ∎
- **I3.** The verdict stays the agent's one bit; a `resolves` revision may itself be pass *or* fail — the
  human never sets the bit. The lock is behavioral (blocks eval *admission*); the `disputed` marker is read
  only by the gate and is structurally excluded from loss aggregation, so it cannot become a second axis. ∎

### 4.3 Genericity (G)

Only P3 touches a framework, and P3 is userland. Linear step order is a property of *video* (one time
axis), not Playwright; "one recording = one scenario" is a P3 obligation satisfied by WebDriver listeners
and a narrating computer-use hand alike. P1/P2/P4/P5/P7 speak only the P2 format and the line schema. Swap
Playwright for WebDriver → a different ~40-line emitter, byte-identical downstream; the computer-use/human
hand is the *same* emitter interface with no framework at all. M's smoothness is a property of the format,
holding even when zero test framework is present. ∎

### 4.4 Soundness of the lock (S)

Let the log be the finite, append-ordered event sequence for S (POSIX `O_APPEND` makes concurrent worker
writes whole-line and totally ordered). Define `locked(S)` = ∃ a dispute d on S with no later reading
carrying `resolves: d`.

- **Total.** A finite scan pairing each dispute with a later `resolves` decides it deterministically; an
  inert `resolves` naming no real dispute simply matches nothing. Total over every log. ∎
- **Deadlock-free.** From `locked(S)` the gate always enables one action — a non-trivial reading carrying
  `resolves: d` — reachable by the human directly or a dispatched agent; "human never returns" is an
  unstarted task, not a mechanism deadlock. ∎
- **Well-founded / no burial.** `locked(S)` quantifies over **every** open dispute, so a later dispute
  cannot silently drop an earlier unresolved one (the burial the first draft admitted; §6-A2): each dispute
  is discharged only by its own `resolves`, monotone. ∎
- **Binding / no bypass.** A `resolves` clears d only if the revision is **non-trivial** (advanced codeSha
  or distinct evidence blob), so a bare re-tag with nothing new is refused — the agent cannot evaporate a
  dispute by re-running (the rubber-stamp the first draft allowed; §6-A1). A world-advancing re-evaluation
  legitimately carries `resolves` and exits the lock through it, not around it. A bad-faith non-trivial
  revision is caught by the human re-disputing → a fresh open dispute → S re-locked, so the human is the
  fixed-point backstop. Binding holds. ∎

## 5. Non-claims (explicit residues, not gaps)

- **N1** Continuing a *prior* annotation in place is not offered: an annotation binds to one clip / one
  scenario version; a re-run stales it, so re-annotation is a fresh dispute, by design.
- **N2** An evaluator-*calibration* signal (scoring how often the agent's verdicts are later disputed) is
  out of scope; it needs an aggregate reading→dispute edge beyond P7's single binding request.
- **N3** Clock-alignment correctness is the emitter's (P3) documented responsibility, inherent to any
  recording design; M localizes it to userland rather than removing it.

## 6. Verification amendments (what the adversarial pass forced)

Three verifiers confirmed C, G, and I1/I2/I3, and refuted the first draft's §4.4 on two points plus a
schema seam; all are folded above.

- **A1 (bypass, critical)** — a bare `{resolves:d, same codeSha, empty blob}` cleared the lock, so "binding"
  was false. Fixed by the **non-trivial revision** rule in P7/§4.4.
- **A2 (burial)** — keying on the *latest* dispute let `d1,d2,resolves:d2` drop d1. Fixed by quantifying the
  lock over **every open dispute**.
- **A3 (U2a totality)** — the lookup was undefined before the first boundary. Fixed by the **t=0 boundary**
  obligation on the emitter (P2).
- **A4 (schema seam)** — the real `readReadings` drops lines lacking `evaluator` and `latestPerScenario`
  would misread a dispute as a reading. Fixed by making P4 an explicit **discriminated union** whose
  reading-only consumers filter dispute lines — a real (small) schema evolution, not zero-change reuse.
- **A5 (I3 by discipline)** — a "disputed pass" is one inference from a second loss bit. Fixed by making the
  `disputed` marker **gate-only and invisible to loss aggregation**, structurally not by promise.

∴ Under §5's stated non-claims and §6's amendments, **M is fully realizable** for {U1,U2a,U2b} with the
yatsu invariants intact and the dispute-lock sound and binding. ∎
