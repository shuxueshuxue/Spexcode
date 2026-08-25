---
title: transcript-reader
status: active
hue: 205
desc: A bounded, interval-addressed read of a harness-native transcript for a durable session.
code:
  - spec-cli/src/transcript-reader.ts
related:
  - spec-cli/src/harness.ts
  - spec-cli/src/index.ts
  - spec-cli/src/execution-trace.ts
  - spec-cli/src/session-timeline.ts
  - spec-dashboard/src/TimelineChat.jsx
---

# transcript-reader

The harness adapter exposes one persistent transcript reader beside its live execution observation. It resolves
the native file from the durable harness thread id, reads only the requested `[from,to]` interval, and returns a
small normalized turn stream: user/assistant prose plus tool calls and their output. Native envelopes, runtime
state, tmux panes, and transcript paths do not cross the adapter boundary.

The public route is `GET /api/sessions/:id/transcript?from=<ms>&to=<ms>`. Both bounds are required finite epoch
milliseconds with `from < to`; an unknown or unmanaged session is a 404, an invalid interval is a 400, and a
harness without this capability returns an explicit unsupported error rather than an empty transcript. A missing,
deleted, unreadable, malformed, or timestamp-less native file is an explicit unavailable response.

The reader is bounded: the response caps turns and tool output bytes and reports `truncated`, `omittedTurns`,
`omittedBytes`, and `outOfOrderEvents` whenever payload was omitted or the native timestamp order crosses back into
or before the requested range. Every
tool result in one native event is matched independently. A result whose call lies outside the interval may be
omitted, but its bytes are counted rather than silently represented as an empty result. After passing `to`, the
reader scans a fixed lookahead window for timestamp disorder before stopping, so the cold tail remains bounded.
A status row in the dashboard supplies the interval and fetches it only when expanded. The transcript remains a
payload, never a field in `timeline.ndjson` or `runtime.json`.
