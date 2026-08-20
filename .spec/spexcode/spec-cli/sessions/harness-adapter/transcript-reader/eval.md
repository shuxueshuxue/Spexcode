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
---

The backend fixture proof is intentionally adapter-local and bounded. The existing cold-readable browser reading
remains the regression proof for the shared Conversation shell; a dedicated transcript browser reading should be
filed once a real harness transcript is available in the isolated fixture.
