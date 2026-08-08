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

The harness adapter is the only layer allowed to know where its native transcript lives or how its JSON lines
are shaped. `execution-trace.ts` turns that private input into an opaque `turnId`, `workingNote`, `revision`,
and a compact ordered tool list. It reads a growing rollout incrementally, retains unfinished trailing bytes,
and resets the visible slice when a newer commentary working note arrives.

A live trace is strictly attached to the current human working turn. The accepted human message's durable
timeline `mid` is the opaque binding token and its `ts` is the acceptance boundary: the session reader
reconstructs both after restart and passes them to every adapter through the same `executionTrace` seam. An adapter
returns no visible note or step until its native transcript has reached the exact matching user-message boundary;
when its native source has no matching id, it may use an unambiguous user boundary at or after the acceptance time.
A newer or mismatched native user boundary also makes the prior slice unavailable. Native timestamps and file
ordinals establish transcript order, but never identify the turn by themselves. The normalized `turnId` is a
binding token only, never a transcript path, native id, or envelope field.

For Codex, one custom tool call becomes one `command`, `read`, `write`, `search`, or generic `tool` step. Its
matching output flips that step from running to done. A step may carry one compact detail derived from a small
allowlist of structured input fields. The adapter truncates it, shortens paths, and omits it entirely when the
input contains credential-like keys or values. The projection never contains raw tool arguments, output,
reasoning, prior commentary, transcript paths, or raw native envelopes. An absent rollout is an empty trace,
not an error or a fabricated conversation entry. [[session-execution]] owns the public HTTP/SSE read of this
value; [[harness-adapter]] owns the registry capability that calls it.
