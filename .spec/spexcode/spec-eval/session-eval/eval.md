---
scenarios:
  - name: proof-bounds-declared
    tags: [backend-api]
    code: [spec-eval/src/sessioneval.ts, spec-eval/src/sessioneval.test.ts]
    description: >
      Score a node that declares ONE passing scenario while its append-only evals.ndjson still carries
      a second, RETIRED scenario's stale reading (removed from eval.md but never deleted from the sidecar).
      Read the proof model's node score, its passed/total ribbon, and the reading cards it renders, and put
      them beside the dashboard's own reading of the same node (score.jsx scenarioStates → aggregateState /
      ScenarioCount). The two must agree.
    expected: >
      The proof scores ONLY the declared scenario, exactly like every other eval face: one reading card (the
      retired scenario's residual reading produces NO phantom card), the node reads a fresh pass, and the
      ribbon counts 1/1 — never 1/2, never a grey stalePass dragged in by the retired reading. This matches
      the dashboard's ScenarioCount (✓1/1) and aggregateState (pass) byte-for-byte: a reading whose scenario
      is no longer declared is residual, not current loss, so it flows into neither the score, the ribbon,
      nor the cards. The proof and the dashboard read one declared-bounded latest-per-scenario, so a merge
      reviewer can never see the proof claim a deleted scenario as outstanding loss the board has already
      dropped.
  - name: session-scope-bounds-impact
    tags: [backend-api, frontend-e2e, desktop]
    test: spec-dashboard/test/session-scope-impact.e2e.mjs
    code: [spec-eval/src/sessioneval.ts, spec-eval/src/sessioneval.test.ts, spec-cli/src/git.ts, spec-cli/src/git.test.ts, spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/EvalsPage.jsx, spec-dashboard/src/EvalsFeed.jsx]
    description: >
      Run the controlled source fixture over a session model where one source file and one scenario's semantic contract
      changed, another scenario in that same eval.md did not, a third affected scenario has no reading,
      a fourth affected scenario has only a stale reading, and the session filed a reading for a scenario
      whose code did not move. Exercise a dirty session sidecar before commit, a pure eval.md reparent, a
      changed-only node in the HTML export, and a changed frontend node with no eval.md. Then drive a real
      browser from the session terminal through the scoped list, detail, and Back; compare toolbar/list/filter
      projections with the lean model while treating the source fixture, not that API echo, as the membership oracle.
    expected: >
      The model contains exactly the scenarios whose own code axis intersects the diff, whose own
      description/expected hash changed, or which this session measured. The untouched sibling is absent.
      The stale reading and the declared-but-unmeasured scenario remain in scope; the latter is the precise
      blind/unmeasured case. The no-eval frontend node is unknown coverage, not a synthetic scenario and not
      part of measured/declared or filter counts. A dirty own reading is immediately measurement-impacted and
      a pure eval.md move impacts nothing. Export retains every changed file and counts/renders missing affected
      scenarios in its denominator. Toolbar, scoped list, detail reachability, CLI, and export consume this one
      scoped model without a second impact predicate. The toolbar's visible fresh-pass, fresh-fail, needs-review,
      and blind tallies add back to the affected total (unknown stays separate); the browser proves that
      accounting, the real UI wiring, and Back behavior.
  - name: session-summary-coherence
    tags: [backend-api, frontend-e2e, desktop]
    test: spec-dashboard/test/session-toolbar.e2e.mjs
    code: [spec-eval/src/sessioneval.ts, spec-eval/src/sessioneval.test.ts, spec-cli/src/graph.ts, spec-cli/src/graphStream.ts, spec-cli/src/graphStream.test.ts, spec-dashboard/src/data.js, spec-dashboard/src/App.jsx, spec-dashboard/src/Dashboard.jsx, spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/EvalsPage.jsx]
    description: >
      Start from a cold graph projection and drive a real Chromium session toolbar through first paint,
      A→B→A session switching, an input-generation change, graph disconnect/reconnect, the scoped Evals
      door, full-model settle, and Back. Count every session /evals request and record the toolbar text on
      every animation frame. In controlled backend fixtures, race an old projection build against a newer
      generation, burst several writes, hold the system idle, and edit/rename/stage source plus change a
      scenario sidecar and trunk remark/main ref.
    expected: >
      The toolbar reads only the session unit carried by graph-full/graph-delta: a cache miss is loading,
      a changed generation is updating with the prior counts intact, disconnect is explicitly last-known,
      and only ready may claim current or show a genuine 0/0. A→B→A never resets or fetches. Burst writes
      publish only the latest generation, an old build cannot overwrite it, and idle time creates zero
      summary requests or computes. Direct dirty source, rename, index-only, sidecar, remark and main moves
      all enter the canonical watcher/invalidation chain. Reconnect graph-full authoritatively re-anchors.
      The first /api/sessions/:id/evals request occurs only after opening scoped Evals; its revision matches
      the graph summary, Back preserves the toolbar value, and no summary-specific SSE/WebSocket/REST poll
      exists.
  - name: proof-renders
    tags: [frontend-e2e, desktop]
    description: >
      Open the scoped list `#/evals?q=is:eval scope:<id>` for a real session and read the DOM: the gates strip, the row list
      (blind spots vs measured, in-session vs earlier), where evidence bytes load, and the export link.
      Open one row's standalone detail, then follow the export link and check the self-contained HTML still
      renders whole (masthead, gates, evidence inlined, diff drill-down).
    expected: |
      The session-scoped list shows the gates strip (lint · merge · ahead · committed, the spex-review
      numbers), then blind spots with the empty ring, this session's own readings ✦-marked and newest-first,
      and the inherited baseline. NO evidence bytes load with the list (rows are tier-1 JSON); blob requests
      begin only after a real row anchor opens its standalone detail. The `export ↗` link serves the
      self-contained export HTML: derived masthead, gate row, inlined evidence, per-file diff drill-down —
      whole, not garbled.
  - name: session-attribution-legible
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/EvalsPage.jsx, spec-eval/src/sessioneval.ts]
    description: >
      Open the scoped list (`#/evals?q=is:eval scope:<id>`) for a session that filed a reading WITHOUT committing code (its codeSha
      is the merge-base) over a node carrying older readings by other sessions plus a retired scenario's
      residual reading. Read the rows in a real browser: verdict marks, the ✦ session attribution, the
      row order, and whether the retired scenario shows.
    expected: >
      Every measured row carries its ✓/✗ verdict mark (muted when stale). Blind spots lead as inert
      unmeasured rows; the session's own readings are ✦-marked and lead the measured rows even when the
      session has no code commits (a reading is the session's own when IT filed it, not only when its
      codeSha is a branch commit); the inherited baseline (other sessions' latest readings) follows,
      legible as NOT the session's own by the absent ✦. A retired scenario (declared in no eval.md)
      contributes NO row — the list is bounded by declared scenarios, the same latest-per-scenario
      computation every eval face reads.
  - name: eval-cli-read
    tags: [cli]
    code: [spec-cli/src/cli.ts, spec-cli/src/client.ts, spec-cli/src/help.ts]
    description: >
      Drive the real CLI against a live backend: `spex eval ls --session <SEL>` on a session with
      committed changes and readings, on a session with an empty diff, and with --json;
      `spex eval ls --session <SEL> --export`, then the removed spellings `spex review <SEL>` and
      `spex session review proof <SEL>`; the help probes (`spex help eval`, `spex eval --help`,
      the `spex help` map). Capture stdout/stderr + exit codes as the transcript.
    expected: >
      `spex eval ls --session <SEL>` renders the /evals model as text in the tab's attention order — gates
      strip, a ✦ legend when the session filed its own readings, per changed node: blind spots lead,
      ✦-marked own readings, then the inherited baseline under a named divider; an empty diff prints a
      clean nothing-to-evaluate line; --json dumps the model. --export writes the self-contained HTML
      path (its --json = the model). The removed spellings are tombstones, not aliases: `spex review`
      signposts `spex session review`, and `spex session review proof` signposts the canonical
      `spex eval ls --session <SEL> --export` — one stderr line, exit non-zero, the old verb never
      executes. Help: the map lists eval as its own noun and an --help probe never fires the verb.
  - name: eval-door-one-chrome
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/evals-entry.e2e.mjs
    code: [spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/EvalsPage.jsx]
    description: >
      Open a session's console in a real browser and read the tab bar: what ELEMENT the Eval entry is
      (tag, href attribute) and what clicking it does (read location.hash + history.length before/after
      + the rendered page); type /eval in the ❯ box and accept it. Read the phone session surface's eval
      door the same way. On the landed page, compare the DOM skeleton (head, rows, anchors) against the
      un-scoped #/evals list; read the gates strip and the export link's href. Check no eval pane ever
      mounts inside the console.
    expected: >
      The console's Eval entry is a DOOR and a REAL ANCHOR — an <a> whose href IS the canonical scoped
      list address, #/evals?q=is:eval scope:<id> (the one scope: token text every session
      door mints; never the legacy ?session param) — so copy-link/middle-click work for free, and clicking
      it PUSHES exactly one history entry landing directly on that final address (no intermediate rewrite).
      The phone session surface's eval door is the same real anchor. The typed /eval navigates to the same
      address. The console itself never mounts an eval pane (the terminal's width never reflows). The
      landed page is the SAME shared list chrome the un-scoped #/evals renders (one component set — no
      session-only clone) carrying the icon-only terminal door as the gates toolbar's leftmost and first
      focusable control, with the short localized back-to-terminal command ([[evals-view]]'s
      scoped-terminal-door), the
      session's gates strip, and the export ↗ link at GET /api/sessions/<id>/evals?format=html. Zero loss
      = one canonical home for a session's evaluation, reached through real-anchor doors.
  - name: session-eval-deep-link
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/route.js, spec-dashboard/src/EvalsPage.jsx]
    related:
      - spec-dashboard/src/Dashboard.jsx
      - spec-dashboard/src/address.js
    description: >
      In a fresh browser tab (a cold app load — the MR-reviewer path), open
      '#/sessions/<id>/eval/<node>/<scenario>' for a session holding a reading on that scenario, and read
      location.hash after settle + the rendered page. Also load the bare '#/sessions/<id>/eval' form, the
      canonical '#/evals/<node>/<scenario>?q=scope:<id>' directly, and a garbage node/scenario under the
      session scope.
    expected: >
      The LEGACY address normalizes at the route layer (replace) to the canonical evals family:
      '#/sessions/<id>/eval/<node>/<scenario>' lands on '#/evals/<node>/<scenario>?q=scope:<id>' — the
      scenario's worktree-rooted detail page (media + remark thread + composer), one click from an MR
      note to the live, remarkable reading; the bare '/eval' form lands on the scoped default list ('#/evals?q=is:eval scope:<id>') (the
      session-scoped list). The canonical address opens identically when pasted directly. A name matching
      nothing renders the honest not-found with the link back to the session-scoped list — never a blank
      page or a crash. Happy, load-failed, and not-found details carry no terminal door: their sole return
      target is the scoped list, whose own leftmost door then returns to the terminal. The old shape never
      re-appears in the address bar.
  - name: branch-new-node-visible
    tags: [backend-api]
    code: [spec-eval/src/sessioneval.ts, spec-cli/src/specs.ts]
    description: >
      Against a live backend, GET /api/sessions/<id>/evals for a session whose branch ADDS a brand-new
      spec node — spec.md + eval.md + filed readings exist only in the session worktree, not on the
      trunk. Read the model's nodes list for that new node: presence, hasEvalFile, declared scenarios,
      readings.
    expected: >
      The branch-new node appears in the model like any trunk node — the node SET, like the readings
      and freshness, is rooted at the SESSION's worktree (a worktree's .spec is the branch's pending
      proposal, not invisible): hasEvalFile true, its declared scenarios listed, its filed readings
      present and inSession-marked when this session filed them — so the session-scoped Evals page and its
      deep link can land on a reading the session filed on a node it just created, while the branch is
      still un-merged. A session with no worktree keeps reading the trunk tree unchanged.
---
# session-eval loss

The controlled source fixture proves scenario membership, impact reasons, dirty-sidecar and rename edges,
and export completeness against explicit inputs. YATU then drives the real dashboard with a session carrying
real changes + readings: the session-scoped Evals pages are read from the live DOM (toolbar, rows, filters,
gates, detail, Back), and the export artifact is opened as a plain document. The browser may prove that every
face consumes the lean API model; it never uses that same API response as the independent membership oracle.
