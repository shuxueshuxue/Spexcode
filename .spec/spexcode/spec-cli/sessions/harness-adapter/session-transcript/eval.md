---
scenarios:
  - name: open-interval-stream-follows-the-thread
    tags: [backend-api]
    test: spec-cli/src/session-transcript.api.test.ts
    code: spec-cli/src/session-transcript.ts
    related:
      - spec-cli/src/harness.ts
      - packages/transcript/src/frames.ts
      - spec-cli/src/index.ts
    description: >-
      Start a real backend against an isolated governed Codex record. Subscribe to the transcript stream before
      the rollout exists, then write a rollout holding an older stretch, the current human boundary, prose, and a
      running tool call; append the call's output; fetch that call's body through the tool route, and probe it
      for an unknown call and without `from`; read the closed-interval GET; probe the malformed and unknown
      routes and the retired execution route; restart the backend and resubscribe.
    expected: >-
      The first frame is the absent `full` payload with no turns. Writing the rollout pushes one `full` frame
      holding only the interval's turns — the human message, the prose, and the call with no output — every turn
      keyed, and never the older commentary. The append pushes a `delta` holding exactly the turn whose call
      completed, its output `null` with the body's true byte count, an empty `removed`, and a later interval end;
      neither the body nor the unchanged turns travel. The tool route returns that body for the call, 404 for an
      unknown call, 400 without `from`. The GET returns the same turns through the same adapter with the body
      inline; a missing bound, a missing from, and an unknown session answer 400, 400, and 404; the execution
      route is a 404. After a restart the resubscription starts from a `full` frame again.
---

Measure through the running HTTP server, not by importing the reader. The rollout must contain more than the
interval so the reading proves omission rather than merely seeing a small fixture.
