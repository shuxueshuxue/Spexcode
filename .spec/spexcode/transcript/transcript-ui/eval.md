---
scenarios:
  - name: grammar-renders-without-a-host
    tags: [cli]
    test: packages/transcript-ui/src/render.test.tsx
    code: packages/transcript-ui/src/index.ts
    description: Render a closed interval and the same interval live through `TranscriptView` with the default context, then with a host context that quotes user turns and replaces a label; render a `LiveTail` with and without a note the record already said; render a long `Quote`.
    expected: History folds three reads behind the answer and never says running; the default prose keeps paragraphs; user turns are boundaries by default and quotes when the host says so; the live interval marks the result-less call as running with verb + target as a sentence; the host's label replaces the count; the tail shows only the newest prose, disappears when the record said it and nothing runs, and drops its caret once a call follows; the quote clamps and names the peer; no emoji is emitted.
---

The package suite (`npm test --workspace=@spexcode/transcript-ui`) is the unit proof; the dashboard's live-tail,
transcript-dedup and conversation-working-tail e2e suites are the product proof of the same components bound in
[[conversation]].
