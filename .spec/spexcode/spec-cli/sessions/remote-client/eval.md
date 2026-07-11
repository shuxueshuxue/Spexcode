---
scenarios:
  - name: cwd-backend-wins
    description: >
      Two projects, two live backends (A and B), each started with `spex serve` from its own
      repo. From project B's directory, in a shell whose environment carries project A's
      SPEXCODE_API_URL (the inherited-env case a backend-launched shell lives in), a bare
      `spex ls` — no flag, no prefix. Identify which backend answered by a session that exists
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
      `spex ls --api http://127.0.0.1:<A-port>` naming project A's backend explicitly.
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
      B's backend live and recorded (the cross-project supervision shape). Run `spex ls`.
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
---

# measuring remote-client backend routing

Bench: two throwaway repos (`spex init` each), two backends via `spex serve` on distinct ports
under an isolated SPEXCODE_HOME. Project A's board carries one marker session (a governed record
in A's per-project store) so a `spex ls` transcript identifies which backend answered. Every
measurement drives the real CLI verbs from a real shell with the env shaped as described —
never an internal helper. Evidence: the CLI transcript (`--result`).
