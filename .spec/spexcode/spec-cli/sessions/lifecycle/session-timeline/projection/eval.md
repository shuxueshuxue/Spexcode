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
---

# session-timeline-projection loss

Measure through `GET /api/sessions/:id/timeline` on a real `spex serve`; importing the wrapper is not evidence.
