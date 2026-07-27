---
title: host resource budget
status: active
hue: 34
desc: Attribute resident session and backend cost, enforce budgets, detect leaks, and guard shared runtime ownership.
code:
  - spec-cli/src/host-resources.ts
related:
  - spec-cli/src/process-identity.ts
  - spec-cli/src/harness.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/client.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/index.ts
  - spec-cli/src/supervise.ts
  - spec-cli/src/layout.ts
  - spec-cli/bin/spex.mjs
---

# host-resource-budget

## raw source

A governed session must not leave the host paying forever for work that ended, and a busy host must explain
where its memory and CPU went before anybody is asked to kill a process. SpexCode therefore keeps a live
resource ledger for every session leaf and project backend, reports budget loss by owner, and detects resources
whose owner is provably gone. Resource pressure never turns
into a command-name kill, a guessed owner, or the loss of unmerged work.

## expanded spec

Resource governance composes with the existing lifecycle instead of inventing another state machine:

- [[state]] remains the source of truth for what work needs. A budget breach or suspected orphan is a resource
  finding, not an inferred lifecycle transition, close, or archive decision.
- [[runtime]] supplies canonical project/session identities and launch artifacts. Live host facts are joined to
  those records; process text alone never grants authority to reclaim.
- [[launch]] still owns admission and its autonomous-work concurrency cap. This node adds measured memory and
  idle-CPU budgets, not another launch path.
- [[harness-adapter]] owns which runtime is a per-session leaf and which is shared. Product code consumes that
  ownership as data rather than matching harness command strings.

### Ownership and identity

Every reported process has a stable instance identity: PID plus the operating system's process-start token.
PID alone is insufficient because it can be reused. Each instance is classified as one of:

- **session leaf** — an adapter-registered agent/turn process owned by exactly one governed session;
- **project control plane** — a backend or adapter runtime shared by a project, with the concrete session/turn
  references that currently depend on it;
- **descendant** — a process carrying a governed session identity and charged to that session, even after
  reparenting; or
- **unattributed** — visible host cost without enough evidence to assign or reclaim it.

Project control planes strip every session-identity variable at their launch boundary. A backend started from
inside a managed agent is still owned by its endpoint/supervisor instance, not by the invoking session; any
control-plane process that retains a session id is reported as an identity leak. The unified launcher performs
this strip before loading the TypeScript runtime so its compiler helper cannot inherit the caller either; the
set of keys comes from the harness adapter registry carried by the session launch environment.
An adapter-registered shared root remains a project control plane even if a legacy generation carries a stale
fallback session id; that leak is a finding, not an ownership transfer. A descendant with a known acting
adapter thread id remains per-session tool work, so the control plane does not absorb real sibling cost.
Each backend supervisor generation registers its own instance id, PID, process-start token, and project root in
the project runtime. The endpoint record marks the current generation; replacing it never makes an older live
generation anonymous. A clean supervisor removes only its own matching registration, while an unclean or
superseded live generation remains charged to that exact backend instance and is reported as an orphan owned by
backend teardown, not made reclaimable through a session lifecycle verb.

The decisive invariant is that ownership does not follow a convenient process-tree edge. In particular, the
Codex app-server is a project-shared control plane: stopping or closing one Codex session may terminate only
that session's registered leaf. It must not signal the shared app-server, its wrapper, or any ancestor that also
serves a sibling. The adapter-observed loaded-thread set is the only runtime refcount: every loaded thread is one
protective reference, and `active` is a state of that same reference rather than an additional count. A queued or
record-only session with no loaded thread remains visible but contributes no reference and no protection; a
loaded thread with no governed record remains a real, protective unowned reference. When the live probe is
unhealthy or unknown, the refcount is unknown rather than reconstructed from records, and the independent
fail-closed stop guard blocks mutation. A stale lifecycle label or an idle tmux shell is not proof that a
headless turn exists, so control-plane health and turn presence are reported separately.

### Budgets and continuous report

The project config declares per-session RSS, per-backend RSS, and idle CPU budgets plus the sampling interval.
Defaults are useful but conservative; a missing local override never hides the report. The running backend
periodically samples its own project, atomically publishes the latest snapshot in the global runtime, and logs
only transitions into or out of loss so an unchanged breach does not become log spam. The same snapshot is
available through `spex session resources` and its JSON form, with:

- sample time and host memory/swap/CPU totals;
- every owner, exact process identities, RSS, sampled CPU, budget, and over-budget amount;
- current and superseded backend generations from the exact-instance registry, independent of which endpoint
  record clients currently resolve;
- each shared control plane's loaded/active references and protection reason;
- orphan/leak findings, evidence for the classification, and whether reclaim is eligible; and
- unattributed cost kept visible as an explicit blind spot.

The sampler must stay cheaper than the work it governs. Shared-runtime probes read lightweight loaded-thread
status only and never load whole conversation histories during a periodic sample.

One process is counted once in host totals. Owner totals use proportional set size when the host exposes it,
falling back loudly to RSS rather than pretending RSS sums are unique memory. Unsupported hosts return an
explicit unavailable report; platform details stay behind one host-process adapter.

### Eligibility and stop guard

Reporting is always read-only. Reclaim eligibility is an advisory projection, not mutation authority. A resource
becomes reclaim-eligible only when live evidence proves its owner is
terminal/retired or absent and no worktree/branch removal is required. A session being old, archived, asking,
idle, over budget, or merely offline is never enough. Shared control planes are never orphan candidates while
the adapter reports at least one loaded thread, whether that reference is active or idle/addressable. Record-only
and queued-without-thread entries remain visible but do not count or protect; loaded threads with no record remain
visible, counted, and protective. An unhealthy/unknown probe reports an unknown refcount, never a synthetic zero.

The existing stop transition asks the adapter-owned target-scoped mutation proof before touching tmux or a leaf.
That proof hard-gates the shared PID/start/isolation/socket generation, uses the lightweight loaded-ID census, and
reads only the exact target thread when it is loaded; full per-reference report projection is read-only evidence,
not mutation authority. The mutation scope is exact: a target leaf with a registered PID/start token and matching
argv/identity may be stopped even when unrelated sibling or unowned loaded references are slow or unresponsive;
their loaded IDs remain protective against any shared app-server/control-plane teardown, which this path never
performs. An unhealthy loaded-ID census, unknown exact target read, target active turn or descendant, or unproven
shared-root identity fails closed before any leaf signal. A target thread that is itself ambiguous or unowned, or
a missing/mismatched leaf PID/start/argv proof, blocks before mutation. The launch
artifact and detached process-boundary evidence are rechecked immediately before the leaf signal and before each
bounded OS escalation; a PID reuse or topology change fails loudly. The report issues no token and has no mutation route;
stop and close remain the only lifecycle verbs. Project-shared control planes and backends are reported with
their teardown owner and references; a session stop never stands in for that owner. There is no `pkill`,
`pgrep`, command-regex signal, port-based signal, automatic close, or branch/worktree deletion in this mechanism.
An unreadable session record proves no adapter or leaf owner, so stop and destructive close fail before signal;
close may quarantine the corrupt control-plane bytes but preserves and reports every runtime/worktree/branch residue.
