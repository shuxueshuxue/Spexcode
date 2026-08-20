---
scenarios:
  - name: bounded-claude-codex-interval
    tags: [backend-api]
    test: spec-cli/src/transcript-reader.test.ts
    code: spec-cli/src/transcript-reader.ts
    description: Read real-shaped Claude JSONL and Codex rollout fixtures through the persistent adapter reader with a bounded epoch interval.
    expected: Only records inside the requested interval become normalized turns, tool output is joined without native envelopes, and caps report omitted turns/bytes.
  - name: loud-transcript-failures
    tags: [backend-api]
    test: spec-cli/src/transcript-reader.test.ts
    code: spec-cli/src/transcript-reader.ts
    description: Ask for unsupported, missing, malformed, and timestamp-less native transcript sources.
    expected: Each case returns an explicit unsupported, missing, invalid, or unreadable reason; no failure is represented as an empty successful transcript.
  - name: lazy-status-disclosure
    tags: [browser, e2e]
    test: spec-dashboard/test/session-surface-cold-readable.e2e.mjs
    code: spec-dashboard/src/TimelineChat.jsx
    description: Expand status rows through a prebuilt dashboard and isolated backend after the real archived session worktree has been removed.
    expected: Collapsed rows make no transcript request; expansion requests the interval once, renders turns, keeps tool output folded until a second click, reuses the cached result, and shows a human-readable unavailable reason for a missing transcript.
---

The backend fixture proof is intentionally adapter-local and bounded. The browser scenario uses a real governed
session and native Claude JSONL in an isolated harness home, then removes that session's worktree before disclosure.
