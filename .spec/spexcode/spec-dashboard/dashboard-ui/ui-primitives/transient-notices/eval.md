---
scenarios:
  - name: feedback-is-transient
    description: >
      In the running dashboard, complete a result-producing action on desktop and phone widths,
      then observe the shared notice surface without changing persistent product data.
    expected: >
      The result is a themed, dismissible status/error notice outside the action layout; it expires
      after the five-second default, and at phone width it remains above the fixed tab bar.
    tags: [frontend-e2e, desktop, mobile]
    code: [spec-dashboard/src/TransientNotice.jsx, spec-dashboard/src/styles.css]
    related:
      - spec-dashboard/src/Root.jsx
      - spec-dashboard/src/EvalsPage.jsx
      - spec-dashboard/src/IssuesPage.jsx
      - spec-dashboard/src/SessionInterface.jsx
---

Measure through the running dashboard in a browser. The proof uses the real Session Command Box and
phone Issues form, while their result POST responses are intercepted so the interaction proves the UI
without creating a message or issue in the live project. Capture both rendered states, wait past the
default duration, and confirm the notices are gone.
