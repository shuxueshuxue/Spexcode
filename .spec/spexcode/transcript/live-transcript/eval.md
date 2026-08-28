---
scenarios:
  - name: live-transcript-is-a-reader
    tags: [cli]
    test: packages/transcript/src/live.test.ts
    code: packages/transcript/src/live.ts
    description: Construct a live Claude transcript, probe its revision, push an init record, a user prompt, an assistant turn with a running call, then the call's result and the result envelope; advance a tail across the pushes and compare with a one-shot read; address another thread.
    expected: The revision is null before any event; the init and result envelopes are not turns and the prompt and call are; the tail's first advance shows the call output-less, the second joins the result to the call from the earlier advance, and the one-shot read equals the cursor snapshot; change listeners fire per recognized event and stop after unsubscribing; another thread id fails as missing.
  - name: same-parser-both-sources
    tags: [cli]
    test: packages/transcript/src/live.test.ts
    code: packages/transcript/src/live.ts
    description: Push Codex rollout records without native ids into a live transcript and read them.
    expected: The turns come back keyed `<role>@<at>` in thread order, exactly as the file reader keys them.
---
