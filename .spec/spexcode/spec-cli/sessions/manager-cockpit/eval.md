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
  - name: review-gate-costs-the-movement-not-the-corpus
    tags: [backend-api]
    code: [spec-cli/src/sessions.ts]
    related: [packages/spec-core/src/anchors.ts, spec-cli/src/lint.ts, spec-eval/src/sessioneval.ts]
    description: >
      Hold the CORPUS fixed and vary only the binary. In one checkout, A/B the parent and candidate
      `packages/spec-core/src/anchors.ts` by launching a branch-local backend on a free port per measurement — its own
      runtime state, no inherited `SPEXCODE_API_URL`, never a deployed backend — with a PATH `git` shim that
      logs every invocation's argv. Wait for each cold process's startup git work to settle, take an idle
      control window, then drive the real HTTP surface: the session-scoped Evals deep link
      (`/api/evals?q=is:eval scope:<id>`) and `GET /api/sessions/:id/review`, each from a cold process, for a
      session whose scope is EMPTY (0 commits ahead, 0 dirty) and for one carrying a ten-file commit. Then,
      inside one live backend, move the served checkout's state and re-read the review after each move: an
      untracked file created, the same file removed, a real HEAD advance committed while the backend runs, a
      dirty rename of an anchored unit, and a malformed `.spec/spexcode.json`. Compare every `gates.lint` with
      `spex spec lint` on that same tree.
    expected: >
      The lint verdict is exactly `spex spec lint`'s for the served tree at every step, dirty files included,
      and identical between the two binaries. The claim measured here is about REPEATED verdicts inside one
      process, and only that: a COLD process pays the location gate in full and both scopes pay it alike — an
      empty scope (0 ahead, 0 dirty) and a ten-file scope each cost the same review children and the same
      hunk queries, and the cold deep-link total does NOT track the reviewed scope (the empty scope measures
      dearer than the ten-file one, because the deep link's own half dominates it). What must hold is that
      each subsequent state move — a dirty edit, its removal, a HEAD advance, an attribute flip — recomputes
      the verdict with git work proportional to what MOVED: no re-derivation of a hunk whose image identity
      this process already read under the pinned interpretation, and no re-streamed window blob, while a moved
      image set is still queried and still judged. Selector validation stays whole: the dirty rename raises
      its dead-anchor integrity error on the very next read. Failure stays loud and poisons nothing: the
      malformed config makes the read fail with its parse error rather than serving a stale or default-shaped
      verdict, is not cached, and the read after repair returns the correct verdict.
      Loss is: a repeated verdict that re-forks one hunk query per anchored path (22 on this tree, argv
      identical to the previous run), a verdict differing from `spex spec lint`, a verdict that survives a
      change to the images or the diff interpretation it was derived from, last-known served after a move, a
      narrowed gate (a skipped selector/anchor check or a sampled corpus), a cached failure, a second resident
      cache of the lint result standing in for proportional work, or any claim that the COLD path or the
      scope-proportionality of the deep link was improved.
---

# measuring manager-cockpit

The cockpit is a backend verb family, so its proof is the real HTTP route and the real `spex` command over a
live backend — not a unit call into `reviewPayload`. The two states that matter are the two the readout must
keep apart: a projection that exists and one that does not.
