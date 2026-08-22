---
scenarios:
  - name: ready-follows-public-bind
    tags: [cli, backend-api]
    description: >-
      Through the installed CLI, start `spex serve --port 0` and `spex serve ui --port Q`, capture each
      process's stdout, and wait until its public port accepts requests. For each surface, then start a second
      process on the occupied port and capture stdout, stderr, and exit status. File the transcript with
      `spex eval add listener-readiness --scenario ready-follows-public-bind --result <txt> --pass`.
    expected: >-
      The first backend publishes its public ready receipt with the kernel-assigned non-zero port only after
      that port has bound and is reachable. The first
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

---
# eval.md - listener-readiness

The scenario measures the shared listener boundary through both installed user-facing serve surfaces. The
success case proves ready publication is not lost; the collision case proves it cannot run before bind.
