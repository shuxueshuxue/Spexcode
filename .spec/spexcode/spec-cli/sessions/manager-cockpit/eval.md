---
scenarios:
  - name: review-reports-measured-loss-without-grading-it
    tags: [backend-api]
    test: spec-cli/test/cockpit-eval-readout.mjs
    code: [spec-cli/src/sessions.ts]
    related: [spec-eval/src/sessioneval.ts, spec-cli/src/cli.ts]
    description: >
      Against a real running backend, read `GET /api/sessions/:id/review` for a live session whose
      session-eval projection has NOT been computed yet, then open that session's scoped Evals route so the
      projection becomes ready, then read the review payload again. Read `spex session review <SEL>` for the
      same session in both states. Compare the payload's `gates.evals` with the session-eval summary the
      scoped response carries, and check what the review call itself did to the projection.
    expected: >
      `gates.evals` is present in both states and never invents numbers. Before the projection is ready it
      carries only an explicit phase — `unavailable`, `loading`, or `updating` — and NO counts; reading the
      review neither builds the model nor schedules one, and the phase is never coerced to zeros or to a
      clean-looking gate. Once ready it carries `{freshPass, freshFail, needReview, blind}` equal to the
      session-eval summary's fresh pass / fresh fail / needs-review / blind, with no verdict, threshold,
      ok flag, block, measured/total aggregate, or unknown-coverage riding along. The CLI prints the same
      four facts when ready and says the projection is not measured yet, with its phase, when it is not.
---

# measuring manager-cockpit

The cockpit is a backend verb family, so its proof is the real HTTP route and the real `spex` command over a
live backend — not a unit call into `reviewPayload`. The two states that matter are the two the readout must
keep apart: a projection that exists and one that does not.
