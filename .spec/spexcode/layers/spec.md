---
title: layers
status: active
hue: 200
desc: Three stacked layers with distinct identities and their own judgement criteria — the data asset, the agent-army substrate, the reference workspace — each worth having without the ones above it.
---

# layers

## raw source

SpexCode is three products wearing one binary, and confusing them is how it would rot. **L0** is meant to
be a git-grade thing: the spec↔code graph and `spex lint`, the accumulated development data asset an
organisation adopts and never throws away — so it must be extremely general, extremely robust, and reach
users through an install surface small enough that nothing can stop it landing. **L1** is what drives an
agent army on top of that asset: the orchestration brick a CI, a code-review pipeline, or a software
factory builds with — so its judgement criteria are scale and composability. **L2** is the default
reference implementation and the productised workspace: the reason this project can dogfood and
self-evolve at all, and the surface where an unprecedented scale of agent command becomes something a
human can actually feel.

They **stack**, and the stack is the point: L1 is built on the asset L0 accumulates, L2 is built on the
orchestration L1 provides. That is also the adoption ladder — a team may take L0 alone and get the whole
data asset, add L1 when it wants an agent army, add L2 when it wants the workspace — so each layer must be
worth having without the ones above it.

## expanded spec

### The three identities, and what each rejects

- **L0 — the data asset.** The spec tree, its git-derived history, `spex lint`, `graph`, `materialize`,
  eval and issue stores. Judged by generality, robustness, and a **minimal adoption surface**: a team that
  wants only the lint gate must be able to install and run it with nothing else present. An install-time
  dependency that can fail on a user's machine is therefore not a packaging detail — it is a barrier to
  the asset ever starting to accumulate, and it is refused at this altitude. Server and terminal
  dependencies are optional and lazily loaded; the verbs that need them fail loud with the install command
  rather than being present-but-broken.
- **L1 — the agent-army substrate.** The session state machine: records, locks, launch, the harness
  adapters, dispatch, liveness. Judged by **scale and composability** — how many agents it can supervise
  without degrading, and how cleanly an external system can drive it as a brick. A supervision mechanism
  whose cost grows with (observers × subjects) is a defect at this altitude even when it is fast enough
  today, because the growth term is what caps the army.
- **L2 — the reference workspace.** The backend's HTTP/SSE/WS faces, the dashboard, the gateway, the host
  hub. A **consumer** of L1, never its gatekeeper. It is the default implementation and the dogfood
  surface, and its own judgement criterion is interaction density.

### L1's exclusion is held by a lock, not by a privileged process

L1 owns resources, and owning needs mutual exclusion — but the exclusion lives in the per-session record
lock (a filesystem lock with a PID liveness check, held across processes), never in the identity of one
blessed process. A backend is a convenient owner of the launch environment and a shared cache, not the
holder of the invariant. So an L1 operation may run in whatever process takes the lock, and a read that
takes no lock needs no permission from anyone. This is not a redefinition of the layering — it is what
lets L1 be a **brick an external system can drive**, which is the criterion L1 is judged by.

### What L1 publishes downward, and what it keeps

L1 writes an append-only log per session ([[session-timeline]]) whose access contract is deliberately
L0-grade: a plain file any process may read with nothing but filesystem access, perturbing nothing. That
is how supervision, CI, and any external orchestrator observe a fleet without being granted anything.

What is published is strictly the **authored** axis — what a session declared, and what was delivered to
it. Two things stay inside L1:

- **Current state.** The log says what happened; `session.json` says what is. A consumer that reconstructs
  "the current status" from the log's last line is misusing it.
- **Liveness**, which never enters the log at all — it is a present-tense derivation, re-probed per read
  ([[state]]), and the probe perturbs what it measures. So a reader holding only the log can never learn
  that a session died, and therefore can never take an action that needs that knowledge. This costs
  nothing to enforce: such a reader sees the same epistemic state as a failed probe, `unknown`, and
  `unknown` already withholds every dangerous entry.

This split — lifecycle authored, liveness derived — was written for a different purpose and keeps paying:
it decides what can be published versus only probed, and how honestly a backend-less read can answer. A
distinction that keeps predicting answers to questions it was not designed for is a real seam.

### The borderland is picked up, never designed for

Because L1's truth is files, small capabilities fall out at the L0/L1 seam for free: a session with no
board membership still has a readable mailbox; a read still works with no backend running; a subscription
may or may not be persisted because it carries no truth. **Pick them up — they cost nothing and the fact
that they fall out at all is evidence the seam sits where it should — but never let one justify a design
decision.** How natural or accessible that seam happens to be is secondary; it is a small thing that
pressures the architecture to stay honest, not a criterion. The layers are judged by the three above.
