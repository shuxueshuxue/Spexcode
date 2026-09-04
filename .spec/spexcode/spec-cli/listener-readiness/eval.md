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

  - name: every-serving-verb-declares-its-bind-face
    tags: [cli, backend-api]
    description: >-
      Through the installed CLI, on a machine that has a non-loopback address, start each serving verb with no
      host given and read the actual bind face out of the kernel's listener table, then probe /health (or /)
      over loopback and over the non-loopback address. Repeat each verb with `--host 0.0.0.0`, with `--host
      <that machine address>`, and — for the public gateway — with `--host 127.0.0.1`. Capture the ready lines
      each surface prints. File the transcript with `spex eval add listener-readiness --scenario
      every-serving-verb-declares-its-bind-face --result <txt> --pass`.
    expected: >-
      With no host given, `spex serve`, `spex serve ui`, and `spex dashboard` all bind the loopback face only:
      the listener table shows the loopback address, loopback answers, and the machine's own non-loopback
      address does not. `spex serve --public` is the one surface whose unstated default is the wide face, and
      it still binds every interface. `--host` is honored by every one of them and never silently dropped: it
      widens a local verb to the wildcard or to one named interface, and it narrows the public gateway to
      loopback. A surface bound to one named interface answers on that address and not elsewhere. Each ready
      line names the face actually bound, a wide ungated bind is announced rather than silent, and a surface
      that binds wide publishes a dialable address rather than the wildcard for other processes to reach it.
    code:
      - spec-cli/src/listen.ts
    related:
      - spec-cli/src/supervise.ts
      - spec-cli/src/cli.ts
      - spec-cli/src/gateway.ts
      - spec-cli/src/gateway-hub.ts
      - spec-cli/src/host.ts
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
