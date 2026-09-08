---
scenarios:
  - name: a-resting-pointer-is-not-a-reader
    description: >
      In the running dashboard, park the pointer over the corner the notice stack lands in, publish one
      notice from a real surface action, and leave the pointer motionless while the progress rule runs.
      Then publish a second notice and move the pointer onto it and away again.
    expected: >
      The notice published under the motionless pointer is never marked paused: its progress rule runs
      from full to empty and the notice is gone by its derived expiry. The notice the pointer actually
      moves onto pauses for as long as it is hovered, holds its remaining time, and resumes when the
      pointer leaves.
    tags: [frontend-e2e, desktop]
    code: spec-dashboard/src/TransientNotice.jsx
  - name: feedback-is-transient
    description: >
      In the running dashboard, complete two result-producing Command Box actions, inspect the
      desktop stack, then resize the same rendered notices to phone width.
    expected: >
      Results are themed, dismissible status/error notices outside the action layout. Their derived
      lifetimes stay within 5–14 seconds, the newest equal-width notice occupies the bottom-right edge
      clear of the status strip, earlier notices are pushed upward without overlapping it, and the
      phone stack remains in the top half of the viewport.
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
