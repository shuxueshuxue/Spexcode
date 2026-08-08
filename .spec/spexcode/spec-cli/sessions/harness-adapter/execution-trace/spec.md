---
title: execution-trace
status: active
hue: 280
desc: A harness-native transcript parser that exposes only the current working note and its typed following tool steps.
code:
  - spec-cli/src/execution-trace.ts
related:
  - spec-cli/src/harness.ts
  - spec-cli/src/execution-trace.test.ts
---

# execution-trace

The harness adapter is the only layer allowed to know where its native transcript lives or how its native event
records are shaped. `execution-trace.ts` turns that private input into `turnId`, `workingNote`, `revision`, and a
compact ordered tool list. Each read receives the current-turn selector reconstructed from the newest durable
human send. Before any such send, the selector is null and the reader may expose the latest native launch slice
with `turnId: null`. Once a selector exists, a reader first finds the exact native user/client identity when it
has one; otherwise it accepts one unambiguous native user boundary at or after the selector's accepted time. It
discards all earlier events and returns empty on no match or ambiguity. A later native user boundary clears the
slice. The selector is never persisted by an adapter or synthesized from native history.

Within the selected slice, a reader takes only the last displayable assistant prose and the tool calls after it.
Structured/private reasoning is never a note. One tool call becomes one `command`, `read`, `write`, `search`, or
generic `tool` step. Its matching completion flips that step from running to done. A step may carry one compact
detail derived from a small allowlist of structured input fields. The adapter flattens whitespace, truncates it,
shortens paths, and omits it entirely when the input contains credential-like keys or values. The projection never
contains raw tool arguments, output, reasoning, prior commentary, transcript paths, or raw native envelopes. An
absent source is an empty trace, not an error or a fabricated conversation entry. [[session-execution]] owns the
public HTTP/SSE read of this value; [[harness-adapter]] owns the registry reader that calls it.
