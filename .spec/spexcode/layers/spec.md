---
title: layers
status: active
hue: 200
desc: Three layers with distinct identities — the data asset, the agent-army substrate, the reference workspace — separated by ONE line: reading a file is L0, owning a resource is L1.
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

The boundary between them is not a stack. It is one line: **reading a file is L0; owning a resource is
L1.** The lock IS that line.

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

### The boundary is the lock

A question that the filesystem alone can answer is **L0**. A question that requires owning a resource — a
record write, a tmux server, a harness control plane, a probe that perturbs what it measures — is **L1**.
The per-session record lock (a filesystem lock with a PID liveness check, held across processes) is the
concrete form of that line: **taking the lock is entering L1; reading without it is staying in L0.**

The consequence is that L1's mutual exclusion is a property of the *lock*, not of any process. There is no
privileged actor. A backend is a convenient owner of the launch environment and a shared cache, not the
holder of the invariant — which is why an L1 operation may run in any process that takes the lock, and why
a read that takes no lock needs no permission from anyone.

### Only authored history crosses the boundary

L1 publishes an append-only log per session ([[session-timeline]]). That log is **L0 data with an L1
writer**, exactly like the eval sidecar and the issue store: any process may read it with nothing but
filesystem access, and reading it perturbs nothing.

What crosses is strictly the **authored** axis — what a session declared, and what was delivered to it.
Two things never cross:

- **Current state** is not the log's job. The log says what happened; `session.json` says what is. A
  consumer that reconstructs "the current status" from the log's last line is misusing it.
- **Liveness never enters the log at all** — it is a present-tense derivation, re-probed per read
  ([[state]]). So a pure L0 reader can never learn that a session died, and therefore can never take an
  action that requires that knowledge. This costs nothing to enforce: such a reader sees the same
  epistemic state as a failed probe, `unknown`, and `unknown` already withholds every dangerous entry.

This split — lifecycle authored, liveness derived — was written for a different purpose and keeps paying:
it decides what can be published versus only probed, how honestly a backend-less read can answer, and
where this boundary sits. A distinction that keeps predicting answers to questions it was not designed for
is a real seam, not a convenient taxonomy.

### The borderland is taken, never designed for

Because L1's truth is files, capabilities fall out of the boundary for free: a session with no board
membership still has a readable mailbox; a read still works with no backend running; a subscription may or
may not be persisted because it carries no truth. **Take them — they cost nothing and they keep the
layering honest — but never let one justify a design decision.** The layers are judged by the criteria
above; a borderland convenience is evidence that the seam is in the right place, not a reason to move it.
