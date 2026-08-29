---
title: spec-first
surface: hook
status: active
hue: 200
events:
- PreToolUse
order: 20
block: true
---
A one-shot, governed-aware ACCESS gate. Its state advances only when the agent is about to read OR mutate code that has a real governor (`code:` ownership). The first such touch creates the session sentinel and blocks once, naming the resolved governing spec and directing the agent through the relevant parent, sibling, and child contracts before retrying. Once that contract-read path has been demanded, later code touches pass.

The state machine has no transition for an irrelevant tool, an unresolvable path, or an uncovered/related-only file. In particular, any number of ungoverned touches remain allowed without consuming or muting the gate; a later governed one must still block.

**Both halves of access are in the trigger, and the reason is written down because it has been lost twice.** Gating mutation alone let a pure analysis session reason straight from the code without ever opening the contract — the grounding gap. Gating reads alone lets a session whose first governed touch is an Edit or Write do exactly the same thing while writing, which is the same hole entered from the other side and the worse one, since the rule this enforces is read the contract FIRST and a blind write is its strongest case. Narrowing the trigger again requires a stated reason; the governed-awareness above is what keeps it quiet, not the choice of verb. This is file governance, distinct from a session record's `governed` field: spec-awareness still serves dashboard-launched and user-self-launched agents alike, with the sentinel created on demand in the session's global store directory.

**The gate is spent by a demand that reached the agent, not by one that was attempted.** The sentinel used to
be written before the reason was rendered, so a render failure burned the session's single chance and said
nothing — the agent was never told, and the gate stayed silent for the rest of the session. The reason is
rendered first; a failure leaves the gate armed, reports itself on stderr, and lets the touch through, because
a gate that cannot say what it wants has nothing to demand.

Event delivery and semantic matching have separate responsibilities. The hook subscribes to the shared `PreToolUse` lifecycle event because Claude and Codex shims deliver that event broadly. The harness adapter's single `access` matcher decides whether the payload represents a file read or mutation and extracts its path; the hook then asks the spec graph whether that path has a governor. Harness payload differences stay inside the adapter, while the gate and its state transitions stay one mechanism.

This enforces the read-the-contract-first rule of [[core]] only where a contract actually exists, at the moment before understanding hardens around governed code.
