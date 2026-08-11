---
scenarios:
  - name: password-gated-remote-client
    description: >
      Start a real `spex serve --public` gateway with a configured password and its default self-signed
      certificate. From a separate CLI process, explicitly address it with `--api`, provide the password,
      and request its session listing; repeat with a target session and `session send`. Also try no password,
      a wrong password, and normal TLS verification.
    expected: >
      `--api <gateway-url> --password <password> --insecure` performs the gateway's designed login once for
      the command, keeps only the signed cookie in memory, then lists and sends through that remote backend.
      Missing or wrong credentials fail loudly without a local fallback. A self-signed certificate remains
      rejected unless the caller explicitly selects `--insecure`; trusted TLS needs no override.
    tags: [cli, backend-api]
    code: spec-cli/src/client.ts
  - name: cache-read-local-fallback
    description: >
      With one governed session record in the cwd project's local store and no backend listening,
      run `spex session ls`, `show <id>`, and `review <id>`. Repeat `ls` with an explicit
      `--api` pointing at a refused port, then against a backend which returns HTTP 500.
    expected: >
      The unflagged read verbs answer from the local store and name that source on stderr; their
      session liveness is `unknown` and no local liveness probe runs. An explicit endpoint remains
      a non-zero unreachable-transport failure, and an HTTP 500 remains a non-zero backend failure
      rather than a local answer.
    tags: [cli, backend-api]
    code: spec-cli/src/client.ts
  - name: cwd-backend-wins
    description: >
      Two projects, two live backends (A and B), each started with `spex serve` from its own
      repo. From project B's directory, in a shell whose environment carries project A's
      SPEXCODE_API_URL (the inherited-env case a backend-launched shell lives in), a bare
      `spex session ls` — no flag, no prefix. Identify which backend answered by a session that exists
      only on A's board.
    expected: >
      The bare command hits project B's backend (the cwd project's recorded live endpoint):
      A's marker session is absent from the listing. The inherited env var does not silently
      route a cwd-project read to another project's backend.
    tags: [cli, backend-api]
    code: spec-cli/src/sessions.ts
  - name: api-flag-overrides
    description: >
      From project B's directory (B's backend live and recorded), run
      `spex session ls --api http://127.0.0.1:<A-port>` naming project A's backend explicitly.
    expected: >
      The explicit --api flag beats every other signal: the listing is A's board (the marker
      session shows), even though cwd discovery would have picked B. `--port <N>` behaves as
      localhost sugar for the same override.
    tags: [cli, backend-api]
    code: spec-cli/src/sessions.ts
  - name: worker-env-lifeline
    description: >
      Simulate a dispatched worker: environment carries SPEXCODE_SESSION_ID and the
      backend-injected SPEXCODE_API_URL of project A, but cwd is project B's directory with
      B's backend live and recorded (the cross-project supervision shape). Run `spex session ls`.
    expected: >
      The worker's env lifeline wins: the read hits project A's backend (the marker shows).
      Cwd-based discovery must never steal a worker's backend-injected endpoint — state
      writes like `session done` ride the same resolution and cannot gamble on discovery.
    tags: [cli, backend-api]
    code: spec-cli/src/sessions.ts
  - name: wrong-project-write-refused
    description: >
      Human shell (no SPEXCODE_SESSION_ID) in project B's directory, B's backend DOWN (its
      runtime record dead), env carrying project A's SPEXCODE_API_URL — so resolution falls
      back to A. Run a mutating verb against A's session:
      `spex session rename <A-session> "STOLEN"`.
    expected: >
      The write is REFUSED loudly, naming both identities (cwd project root vs the backend's
      served root) and the explicit-routing remedy (--api). No rename lands on A. Read verbs
      in the same setup stay unguarded (viewer-points-anywhere).
    tags: [cli, backend-api]
    code: spec-cli/src/client.ts
  - name: peer-project-operations-stay-remote
    description: >
      With an established loopback peer forward, use `spex session ls --ssh <address> <full-id>` and
      `spex session new --ssh <address> <full-id> <prompt>` through the real CLI. Record the forwarded
      requests, then repeat creation against an absent peer.
    expected: >
      Both operations use the peer forward and the full id only as the remote gateway's project anchor.
      Listing returns the normal default board. Creation carries a closed requestKey envelope, has no parent,
      emits a runnable peer reply hint for a governed caller, and fails loud on an absent peer without a
      local in-process create fallback.
    tags: [cli, backend-api]
    test:
      path: spec-cli/src/machine-peer.test.ts
      name: the peer and session CLI surfaces use the gateway-owned peer forward
    code: spec-cli/src/client.ts
    related: [spec-cli/src/machine-peer.ts, spec-cli/src/cli.ts]
  - name: explicit-close-history-read-stays-on-its-named-backend
    description: >
      Point `spex session ls --all <id> --api <url>` at a controlled backend with an empty board and a terminal
      close-history answer, then repeat for a capability-marked 404 history miss and an unmarked legacy-route
      404. The latter must fail as incompatible rather than use local history or say never existed.
    expected: >
      Both board and close-history requests stay on the explicit backend; a close hit is success, while a 404
      history miss becomes the named nonzero never-existed answer. No local ledger fallback occurs.
    tags: [cli, backend-api]
    test:
      path: spec-cli/src/session-ls-cli.test.ts
      name: session ls names terminal close history instead of collapsing it into a never-existed miss
    code: [spec-cli/src/client.ts, spec-cli/src/session-ls-cli.test.ts]
---

# measuring remote-client backend routing

Bench: two throwaway repos (`spex init` each), two backends via `spex serve` on distinct ports
under an isolated SPEXCODE_HOME. Project A's board carries one marker session (a governed record
in A's per-project store) so a `spex session ls` transcript identifies which backend answered. Every
measurement drives the real CLI verbs from a real shell with the env shaped as described —
never an internal helper. Evidence: the CLI transcript (`--result`).
