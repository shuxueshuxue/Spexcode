---
scenarios:
  - name: only-econnrefused-licenses-the-local-path
    tags: [cli, backend-api]
    code: [spec-cli/src/sessions.ts#sessionCreateRequest]
    description: >
      Run `spex session new` against a live backend, against a port with no listener, against a listener that
      accepts and hangs past the budget, against one that returns 500, and against a backend whose instance
      identity resolves to a different project.
    expected: >
      A live backend owns the keyed create. Only the no-listener case — whose entire transport cause chain is
      ECONNREFUSED — runs the in-process fallback. Timeout, reset, and DNS failures fail without local creation;
      a 500 proves ownership rather than being relabelled indeterminate; the mismatched project is refused. The
      probe is the identity route alone and stays inside its own 1500ms budget.
  - name: a-create-pins-and-records-its-fork-point
    tags: [cli]
    code: [spec-cli/src/sessions.ts#sessionCreateRequest]
    description: >
      Create with a `base` naming a real commit, with one naming nothing, and with none at all; read each
      record, the worktree's start point, and the idempotency payload hash of a retry that changes the pin.
    expected: >
      A resolved pin becomes the `git worktree add` start point and is stored; an unresolvable one fails 400
      before any Git mutation and leaves no worktree, branch, store, or receipt. Every create records the commit
      it actually forked from, while an unpinned create keeps its exact legacy record bytes and receipt hash, and
      a retry that changes the pin hashes as a different request.
---
# measuring session-create-authority

Both halves are settled before Git moves, so both are measured by what is left behind on the failing paths.
