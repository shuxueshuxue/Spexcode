---
scenarios:
  - name: producer-and-subscriber-round-trip
    tags: [cli]
    test: packages/transcript/src/frames.test.ts
    code: packages/transcript/src/frames.ts
    description: Feed a producer the same interval read repeatedly — unchanged, a call completing with a new turn, the cap evicting two turns — and merge every frame it yields on the subscriber side; then merge an error frame and a kind-less frame.
    expected: The first frame is full with a running call output-less; an unchanged read yields no frame; the next delta carries only the changed and the new turn with the recorded body withheld as null and its byte count told; eviction names the removed ids and the counters are absolute; after every merge the held turns equal the interval; an error frame passes through leaving the held turns; a kind-less frame is read whole and the wire kind never reaches the payload; a reset makes the next frame full.
  - name: frame-stream-publishes-only-change
    tags: [cli]
    test: packages/transcript/src/frames.test.ts
    code: packages/transcript/src/frames.ts
    description: Open a frame stream on a live transcript before any event, publish, push a user turn, publish twice, push an assistant turn, publish; then open streams on an unsupported reader, a reader whose tail throws a plain error, and one whose tail fails with a TranscriptReadError.
    expected: The absent stream yields one empty full frame with revision `absent` and then nothing; the first event yields a full frame and an unchanged revision nothing; the second event yields a delta with only the new turn; the unsupported reader reads as absent, the plain error propagates, and the transcript failure becomes an error frame carrying its reason.
---
