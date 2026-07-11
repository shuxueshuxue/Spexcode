---
scenarios:
  - name: edit-shows-uncommitted-node
    tags: [backend-api]
    description: >-
      Through the real backend, in a worktree create a brand-new spec node whose spec.md is
      written but NOT committed (untracked), then GET `/api/edit?source=<worktree>&path=<spec.md>`
      for three paths: that untracked new node, a tracked spec.md with no pending change, and a
      tracked spec.md with an uncommitted edit. File the transcript with
      `spex yatsu eval spec-cli --scenario edit-shows-uncommitted-node --result <txt> --pass`.
    expected: >-
      The untracked brand-new node returns a NON-empty all-additions diff carrying its full
      spec.md body (not `{patch:""}`), so the overlay edit tab shows the just-created node's
      content instead of nothing; the tracked-unchanged path stays empty (no false positive);
      the tracked-edited path returns its real working-tree diff.
    code: spec-cli/src/index.ts
  - name: port-bind-failure
    tags: [backend-api]
    description: >-
      Drive the shared port-ownership contract through the real CLI. Start `spex serve --port P`,
      wait until P serves, then run a SECOND `spex serve --port P` on the same port; capture its
      exit code, its stderr, and whether the private child it booted before failing is still
      listening. Repeat with `spex dashboard --port Q` (two on the same Q). File the transcript with
      `spex yatsu eval spec-cli --scenario port-bind-failure --result <txt> --pass`.
    expected: >-
      The second `serve` exits NON-ZERO (1) printing a single loud line naming the busy port and the
      repair (`cannot bind — port P is already in use. Free :P …`), never a "serving" success line,
      and leaves NO zombie child (the private port it booted is no longer listening); the first serve
      is untouched. The second `dashboard` behaves identically (exit 1, the same `cannot bind` line) —
      one busy-port condition, one behaviour on both surfaces, not a silent zombie under serve and a
      crash under dashboard.
    code: [spec-cli/src/listen.ts, spec-cli/src/supervise.ts]
    related: spec-cli/src/gateway.ts
  - name: server-reaps-abandoned-connections
    tags: [backend-api]
    description: >-
      Drive the connection-reaping contract through the REAL backend. Start the child server, then open a raw
      socket that sends PARTIAL headers and never completes the request (an abandoned/slow client — the shape
      every client-side timeout-kill leaves behind), and observe when the SERVER closes it. Separately, confirm
      an ACTIVE long-lived response is NOT reaped: open the board-stream SSE (`/api/board/stream`) and hold it
      idle past the timeout — it must stay open. File the transcript with `spex yatsu eval spec-cli --scenario
      server-reaps-abandoned-connections --result <txt> --pass`.
    expected: >-
      The stalled/partial request is REAPED server-side (the server closes the socket) at ~headersTimeout,
      never left to linger indefinitely / to the multi-minute Node default — so abandoned connections cannot
      pile up and wedge the backend (the 135-conn starvation that started the mass-restore cascade). The active
      board-stream SSE is UNTOUCHED (an active response is not idle keep-alive), so a real dashboard's live
      stream is never severed by the reaper. The raw-TCP supervisor proxy propagates a close on either half to
      both, so a reaped upstream frees its public-side socket too.
    code: [spec-cli/src/index.ts, spec-cli/src/supervise.ts]
    related: spec-cli/src/gateway.ts
  - name: board-conditional-request
    tags: [backend-api]
    description: >-
      Drive the board's conditional-request contract through the real backend. GET `/api/board`
      once and capture the response status, the `ETag` header, and the body size. Then GET it
      again sending `If-None-Match: <that ETag>`, and once more sending a deliberately stale
      `If-None-Match` value. File the transcript with
      `spex yatsu eval spec-cli --scenario board-conditional-request --result <txt> --pass`.
    expected: >-
      The first GET is `200` with an `ETag` header over the serialized body. The matching
      `If-None-Match` request returns `304 Not Modified` with NO body (the saved transfer), still
      echoing the same `ETag`. A stale `If-None-Match` returns the full `200` body — so the
      endpoint speaks standard conditional-request HTTP, with no special-casing of the poll path.
    code: spec-cli/src/index.ts
---
# yatsu.md — spec-cli

This node's `/api/edit` route is measured through the real backend HTTP surface (YATU): the AGENT hits the
live endpoint against a worktree holding a genuinely-untracked new node and files the transcript as a
reading. The loss being watched is the edit tab going blank for a just-created, uncommitted node — `git
diff <fork-base>` is blind to untracked files, so the contract is honoured only if the endpoint falls back
to an all-additions view for an untracked spec.md while leaving tracked paths untouched.
