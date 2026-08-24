---
scenarios:
  - name: feedback-is-transient
    description: >
      In the running dashboard, complete two result-producing Command Box actions, inspect the
      desktop stack, then resize the same rendered notices to phone width.
    expected: >
      Results are themed, dismissible status/error notices outside the action layout. Their derived
      lifetimes stay within 5–14 seconds, the first equal-width notice occupies the top-right edge,
      later notices grow downward without overlapping the earlier one, and the phone stack remains in
      the top half of the viewport.
    tags: [frontend-e2e, desktop, mobile]
    test: spec-dashboard/test/command-box-new.e2e.mjs
    code: [spec-dashboard/src/TransientNotice.jsx, spec-dashboard/src/noticeTiming.js, spec-dashboard/src/styles.css]
    related:
      - spec-dashboard/src/Root.jsx
      - spec-dashboard/src/EvalsPage.jsx
      - spec-dashboard/src/IssuesPage.jsx
      - spec-dashboard/src/SessionInterface.jsx
---

Measure through the running dashboard in a browser. The proof uses the real Session Command Box twice
against its isolated fake-harness fixture, then resizes the same pair to phone width. Capture both
rendered states and record the interaction timeline with the video; direct timing tests verify the
length-to-duration curve and explicit-duration override.
