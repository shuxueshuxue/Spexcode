---
scenarios:
  - name: bounded-claude-codex-interval
    tags: [backend-api]
    test: spec-cli/src/transcript-reader.test.ts
    code: spec-cli/src/transcript-reader.ts
    description: Read real-shaped Claude JSONL and Codex rollout fixtures through the adapter reader with a bounded epoch interval, including a Codex final answer and more turns than the cap.
    expected: Only records inside the requested interval become normalized turns, parallel tool results are all joined without native envelopes, orphan output bytes are reported as omitted, the cap keeps the newest turns and counts the dropped ones, and timestamp disorder reports honest truncation.
  - name: pi-and-opencode-native-shapes
    tags: [backend-api]
    test: spec-cli/src/transcript-reader.test.ts
    code: spec-cli/src/transcript-reader.ts
    description: Read a pi session JSONL located by its header id and an OpenCode export cached by store revision, each with private reasoning, a tool call, and its result.
    expected: Both readers return the same normalized turn shape as Claude and Codex; a running OpenCode tool has no output field; an unchanged store is not exported again while a moved write-ahead log is; reasoning never appears.
  - name: open-interval-reread-seeks
    tags: [backend-api]
    test: spec-cli/src/transcript-reader.test.ts
    code: spec-cli/src/transcript-reader.ts
    description: Read one open interval of a long Claude thread, append the running tool's result, observe the revision move, and read the same interval again.
    expected: The first read shows the call without output; the append changes the revision; the second read joins the output and, because it resumed at the interval's first event, counts nothing older as omitted.
  - name: loud-transcript-failures
    tags: [backend-api]
    test: spec-cli/src/transcript-reader.test.ts
    code: spec-cli/src/transcript-reader.ts
    description: Ask for unsupported, missing, malformed, and timestamp-less native transcript sources, and probe their revisions.
    expected: Each read returns an explicit unsupported, missing, invalid, or unreadable reason and an absent source's revision is null; no failure is represented as an empty successful transcript.
  - name: one-reader-per-harness
    tags: [backend-api]
    test: spec-cli/src/transcript-reader.test.ts
    code: spec-cli/src/harness.ts
    description: Inspect the registered adapters' transcript readers.
    expected: The four base harnesses carry four distinct readers, every headless adapter shares its base reader, and z-code's reader is the unsupported one.
  - name: lazy-status-disclosure
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/session-surface-cold-readable.e2e.mjs
    code: spec-dashboard/src/TimelineChat.jsx
    description: Expand status rows through a prebuilt dashboard and isolated backend after the real archived session worktree has been removed.
    expected: Collapsed rows make no transcript request; expansion requests the interval once, renders turns, keeps tool output folded until a second click, reuses the cached result, and shows a human-readable unavailable reason for a missing transcript.
---

The backend fixture proof is intentionally adapter-local and bounded. The browser scenario uses a real governed
session and native Claude JSONL in an isolated harness home, then removes that session's worktree before disclosure.
