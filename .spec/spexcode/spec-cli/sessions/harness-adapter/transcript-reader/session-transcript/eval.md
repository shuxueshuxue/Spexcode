---
scenarios:
  - name: open-interval-stream-follows-the-thread
    tags: [backend-api]
    test: spec-cli/src/session-transcript.api.test.ts
    code: spec-cli/src/session-transcript.ts
    related:
      - spec-cli/src/harness.ts
      - spec-cli/src/transcript-reader.ts
      - spec-cli/src/index.ts
    description: >-
      Start a real backend against an isolated governed Codex record. Subscribe to the transcript stream before
      the rollout exists, then write a rollout holding an older stretch, the current human boundary, prose, and a
      running tool call; append the call's output; read the closed-interval GET; probe the malformed and unknown
      routes and the retired execution route; restart the backend and resubscribe.
    expected: >-
      The first frame is the absent payload with no turns. Writing the rollout pushes one frame holding only the
      interval's turns — the human message, the prose, and the call with no output — and never the older
      commentary. The append pushes the same shape with the output joined and a later interval end. The GET returns
      the same turns through the same adapter; a missing bound, a missing from, and an unknown session answer 400,
      400, and 404; the execution route is a 404. After a restart the resubscription reads the thread again.
---

Measure through the running HTTP server, not by importing the reader. The rollout must contain more than the
interval so the reading proves omission rather than merely seeing a small fixture.
