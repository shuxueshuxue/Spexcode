---
title: output-fold
status: active
hue: 280
desc: When two handlers on one event both speak the structured hook contract, their documents fold into ONE payload with defined precedence, instead of being concatenated into something the harness cannot parse.
code:
  - spec-cli/src/hook-merge.ts
related:
  - spec-cli/hooks/dispatch.sh
  - spec-cli/src/cli.ts
  - spec-cli/src/hook-dispatch.test.ts
---

# output-fold

## raw source

[[dispatcher-runtime]] runs every handler bound to an event and hands their stdout to the harness. For as long
as exactly one handler per event emitted JSON, writing each handler's stdout straight through was indis-
tinguishable from correct: concatenating an empty string and one document yields that document.

But a plugin system exists precisely so someone can bind a SECOND handler to an event that already has one.
The moment two of them speak the structured contract, concatenation produces `{…}{…}`. That is not a document
in which one handler's field lost to another's — it is not a document at all, so the harness discards the
whole response and BOTH handlers are silenced at once. The failure is invisible from either handler's side:
each one ran, each one wrote what it meant to write, and neither can observe the other.

Relying on "only one handler speaks per event" is a convention no mechanism enforces, held by an arrangement
that the extension point invites people to break.

## expanded spec

Handler stdout is collected in manifest order and emitted once. Zero or one structured document is passed
through unchanged — byte for byte the old behavior, costing nothing, which is every dispatch the core hook set
produces today. Two or more are folded into a single document.

**The fold lives in the CLI, not the shell.** Deciding which of two `decision` fields wins is a semantic
question about the harness contract, and shell cannot read a JSON object without growing a parser. The
dispatcher performs only a shape test (does this stdout start with `{`) and hands the parts, NUL-separated
because handler output may contain anything, to `spex internal hook-merge`. This is reached only when two
handlers actually emitted JSON, so the hot path keeps its no-node-boot property.

Precedence is by field, and every rule answers "what would silently disarm a handler":

- `decision` — `block` beats `approve`. A block from any handler is the dispatch's verdict already, so the
  folded document must not be able to downgrade it. Reasons are joined, never replaced.
- `continue: false` and `suppressOutput: true` are sticky in both directions: a halt one handler asked for
  cannot be undone by a neighbor that did not ask for it.
- `permissionDecision` — `deny` > `ask` > `allow`, the safest answer any handler gave.
- Free text (`reason`, `systemMessage`, `stopReason`, `additionalContext`, `permissionDecisionReason`) is
  concatenated in handler order, so nothing a handler said is dropped.
- `hookEventName` takes the first, since all handlers on one dispatch share the event.
- **Any other key has no merge rule, and that is reported rather than resolved.** Identical values are not a
  conflict. Different values keep the FIRST handler's and name the collision on stderr, because quietly
  picking one is exactly how a handler ends up disarmed by a neighbor it never knew about. Unknown vocabulary
  is still carried: a plugin may legitimately emit fields this node has never heard of.

Non-JSON stdout stays passthrough text and keeps its order; the folded document is emitted last, so a harness
reading the whole stream still finds exactly one object.

**Degradation is loud and valid.** If two documents need folding and the CLI cannot be reached, the dispatcher
emits the FIRST document alone and says so on stderr. A valid document that lost a handler is a recoverable
loss the reader is told about; an unparseable one loses every handler silently, which is the defect this node
exists to remove.
