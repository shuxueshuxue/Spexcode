---
title: self-launch CLI
status: active
hue: 280
desc: One-shot argv-to-protocol commands for direct harness adoption without a daemon, drain loop, polling, or wake dependency.
code:
  - packages/session-selflaunch/src/cli.ts
related:
  - .spec/spexcode/session-runtime/adopter-cutin/spec.md
  - .spec/spexcode/session-protocol/spec.md
---
# self-launch CLI

`spex-session` is a one-shot command surface. Each invocation parses one of `initialize`, `enqueue`, `dequeue`, or
`pending`, resolves and verifies one database path, opens the protocol, performs exactly one operation, closes it,
and prints one JSON line. There is no daemon, resident process, automatic drain, polling, wake correctness path, or
retry loop.

`enqueue` accepts UTF-8 text and never accepts a producer-supplied message id. The protocol creates the id. Every
message output renders opaque bytes as `bodyBase64`; it never guesses that bytes are text. Repeated `--header K=V`
arguments split on only the first equals sign. Empty dequeue is successful JSON `null`.

Usage and argv errors exit 2. Protocol and locality errors exit 1. Errors use the exact single-line form
`spex-session: CODE: message`, including a repair hint when the protocol reports a missing database parent. The
locality bypass exists only as the explicit `--assume-local-storage` argv flag.
