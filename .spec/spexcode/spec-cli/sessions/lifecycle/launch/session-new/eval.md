---
scenarios:
  - name: public-create-is-bounded-and-atomic
    tags: [backend-api, cli]
    description: >
      Start an explicitly targeted backend for an isolated initialized Git project and use a controllable
      headed launcher. Through the real public POST /api/sessions surface, first stall a pre-publication Git
      worktree phase past the configured create budget; also abort one request from the client and race two
      requests carrying the same Idempotency-Key. Timestamp the request, creation lock, Git, record write, and
      launcher-queue phases. After each terminal response inspect the public session list, global session store,
      git worktree list, refs/heads/node namespace, child processes, and tmux server. Finally release the
      controllable launcher and run one ordinary successful create with a [[node]] target. Generate two
      different keys whose deterministic ids share the same four-character branch suffix and send the same
      prompt with both. Through the real CLI without --api, point SPEXCODE_API_URL at a listener that accepts
      but never answers settings. Verify that issue `@new` reaches the same bounded transaction owner rather
      than an exported preparation function. In isolated backend processes, kill the backend immediately
      after a real Git worktree add and again immediately after the candidate store files are written; restart
      on the same project/store and retry the same Idempotency-Key. Also present an occupied candidate under a
      different key and an occupied orphan with an invalid or absent private receipt. Force private-receipt
      retirement to fail after a successful record publication, then request close; if close succeeds, create
      a different-key session with the same branch/path suffix and retry the old key.
    expected: >
      A timeout or disconnect settles within the configured wall with structured code and phase, kills the
      active Git group, and leaves zero session row, store directory, worktree, branch, or launcher pane; no
      artifact appears later. Concurrent same-key requests publish exactly one normal queued/starting receipt
      with one id, worktree, branch, record, and launcher attempt, and either response can recover that receipt.
      Reusing that key with another payload fails without mutation. A successful targeted create does not run
      history/drift indexing before publication, returns inside the budget even while the headed launcher is
      stalled, and the structured timestamps show record publication preceding launcher-queue work. A
      candidate whose checked-out branch changes before record write is rolled back with no row; `201` always
      names the exact worktree top-level, checked-out branch, and live branch ref it publishes. A different-key
      same-suffix collision fails without changing the first receipt's row, store, exact branch, or worktree;
      an owned abort still removes only its own resources. The implicit-target slow listener settles inside the
      one settings-probe wall with an indeterminate error and no POST/fallback/artifacts. `sessionCreateRequest`
      is the sole exported create function and `@new` enters it, so maintenance/deadline ownership cannot be
      bypassed. After either process death, the matching-key restart uses the atomic private receipt to remove
      only its pre-publication resources and then yields one exact published receipt (or an exact cleanup
      failure), never permanent occupied `409`. A different key or invalid/unreceipted orphan is preserved and
      fails loud; candidate presence alone never becomes cleanup authority. A published-but-unretired receipt
      remains fenced by its public row: close refuses before stop/deletion unless it can retire and prove that
      receipt absent. Therefore the old key can never later enter matching cleanup against a different session
      that reused the same branch/path.
    code: spec-cli/src/sessions.ts, spec-cli/src/index.ts, spec-cli/src/client.ts
    test: spec-cli/src/session-create-transaction.test.ts
---

# measuring session-new

The closure proof uses an isolated real backend and the public HTTP route, with a real Git repository and
tmux transport. Unit seams may make the phase stall deterministic, but an internal `newSession()` call alone
cannot pass this scenario because it omits HTTP disconnect, response shape, and explicit backend targeting.
