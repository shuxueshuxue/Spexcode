---
scenarios:
  - name: ready-follows-public-bind
    tags: [cli, backend-api]
    description: >-
      Through the installed CLI, start `spex serve --port P` and `spex serve ui --port Q`, capture each
      process's stdout, and wait until its public port accepts requests. For each surface, then start a second
      process on the occupied port and capture stdout, stderr, and exit status. File the transcript with
      `spex eval add listener-readiness --scenario ready-follows-public-bind --result <txt> --pass`.
    expected: >-
      The first backend publishes its public ready receipt only after P has bound and is reachable. The first
      UI publishes its resolved dashboard-dist provenance and gateway receipt together only after Q has bound
      and is reachable. Each colliding process exits 1 with one `cannot bind` repair on stderr and publishes
      none of those ready lines, so private startup work can never be mistaken for public availability.
    code:
      - spec-cli/src/listen.ts
    related:
      - spec-cli/src/supervise.ts
      - spec-cli/src/index.ts
      - spec-cli/src/gateway.ts
      - spec-cli/src/port-bind.cli.test.ts

  - name: ready-publishes-kernel-assigned-port
    tags: [cli, backend-api]
    description: >-
      Through the installed CLI, start `spex serve --port 0`, capture its ready line, and connect to the
      published port. Repeat with a concrete non-zero port and verify its ready line preserves that requested
      value. File the transcript with `spex eval add listener-readiness --scenario
      ready-publishes-kernel-assigned-port --result <txt> --pass`.
    expected: >-
      A request for port 0 publishes the kernel-assigned non-zero port and that port accepts requests; a
      request for a non-zero port publishes the same port byte-for-byte. No ready line advertises :0.
    code:
      - spec-cli/src/listen.ts
    related:
      - spec-cli/src/supervise.ts
      - spec-cli/src/gateway.ts
      - spec-cli/src/gateway-hub.ts
      - spec-cli/src/port-bind.cli.test.ts

---
# eval.md - listener-readiness

The scenarios measure the shared listener boundary through both installed user-facing serve surfaces. The
first proves ready publication is ordered after bind; the second proves the published endpoint is the actual
listener when the kernel chooses the port.
