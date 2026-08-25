---
scenarios:
  - name: http-projection-resolves-and-maps
    tags: [backend-api]
    description: >
      Start a real backend over an isolated store containing one governed session with a public alias, one
      non-governed record, and authored timeline events. GET the timeline by alias, by the non-governed id, and by
      an absent id.
    expected: >
      The alias resolves to the governed session and returns the durable tail oldest-first with SpexCode display
      vocabulary. The non-governed and absent rows both fail on the HTTP surface instead of leaking a raw log.
  - name: migrated-history-in-occurrence-order
    tags: [backend-api]
    description: >
      Append migrated legacy history (older occurrence, later sequence) beside live state events on one session and
      read its timeline.
    expected: >
      The migrated status and sent rows appear before the live rows they predate, map to the same display kinds, do
      not change the replayed state, and the stamp is still the last appended sequence.
    test:
      path: spec-cli/src/session-timeline.test.ts
      name: "timeline shows migrated legacy history where it happened, not where it was appended"
---

# session-timeline-projection loss

Measure through `GET /api/sessions/:id/timeline` on a real `spex serve`; importing the wrapper is not evidence.
