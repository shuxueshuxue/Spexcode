---
concern: zcode-harness declares app-server observation and child-lifecycle contracts that neither its code axis nor its sole materialization scenario can prove
by: fbb76f84-7a73-4262-81d6-9028f5eb7c4e
status: open
nodes: zcode-harness
created: 2026-08-10T05:37:58.810Z
---

Spec: zcode-harness

## Observation
The active zcode-harness spec makes contracts about app-server JSON-RPC observation, V4 SubagentRow cold replay/hydration, child status and lineage, workspaceId worktree behavior, and explicit session-id correspondence. Its only code axis is the entire spec-cli/src/harness.ts file; its sole scenario, zcode-materialize-stop-gate, only measures generated .zcode/settings.json hooks from spex init/materialize.

## Why this is drift
The scenario can honestly prove the supported one-shot hook-materialization surface. It cannot prove the runtime observation, child lifecycle, app-server, or worktree contracts written in the same node. Conversely, a whole-file harness.ts axis makes unrelated adapter edits stale this one materialization reading. Filing a fresh pass would be a false green; bulk narrowing would silently drop protocol intent.

## Bounded repair decision
First map each non-materialization claim to its actual implementation and product surface. Then choose one explicit shape: (1) retain this node for adapter-row/materialization-only intent and move implemented observation contracts to their actual owner(s), or (2) extract a zcode runtime/bridge implementation owner with narrow code selectors and real product scenarios. Do not change drift/freshness semantics or auto-ack this node. Any source behavior change remains decision-gated by the campaign ledger.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T12:16:04.316Z -->
Spec: zcode-harness

Read-only claim map completed. The current adapter owns settings/hook materialization, zcode prompt launch, liveness, and explicit delivery/resume refusal. App-server NDJSON observation, V4 row hydration, child lineage, workspaceId V4 routing, and caller-chosen native session IDs are upstream ZCode capabilities that SpexCode does not bridge or project today. The current materialization scenario cannot prove any of them.

A separate concrete bug was opened as zcode-stop-hook-is-generated-but-dispatch-silent: the emitted dispatch.sh zcode Stop is currently parsed as event zcode and exits 0. It can be repaired against existing intent with a real Stop proof.

Do not silently narrow this spec or implement a bridge in the same change. The remaining ownership decision is explicit: retain zcode-harness as the static adapter and move runtime claims out, or create a decision-gated zcode-runtime-bridge owner for app-server lifecycle, NDJSON transport, replay/projection, reconnect, and native ID persistence. Native child IDs must not be equated with Spex governed nodes without a separate product-contract decision.
