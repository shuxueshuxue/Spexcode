---
title: runtime-repair
status: active
hue: 28
desc: Explicit operator repair for a live but unhealthy shared Codex runtime.
code:
  - spec-cli/src/runtime-rotate.ts
related:
  - spec-cli/src/cli.ts
  - spec-cli/src/help.ts
  - spec-cli/src/codex-runtime-generations.ts
  - spec-cli/src/codex-runtime-generations.test.ts
  - spec-cli/src/runtime-rotate.cli.test.ts
---

# runtime-repair

## raw source

A shared Codex app-server can remain alive while its own workers or private memory are exhausted. New
sessions then fail at the thread-start boundary, but killing that process would also discard unrelated
loaded conversations.

## expanded spec

`spex runtime rotate codex [--launcher <name>]` is a local, explicit repair action. It resolves a
configured Codex or Codex-headless launcher from the project main checkout, then resolves the separate
per-project runtime store for the generation ledger. It removes session-specific environment identity from
the detached child and starts the matching app-server binary with a new ledger endpoint. The command is not
a backend request and does not create a session or native thread itself.

The generation ledger is the sole authority for publication. The command succeeds only after the new
endpoint has proved its detached process and socket identity and the ledger has atomically made it
current. Existing bindings remain unchanged on the prior draining root; this module sends no signal to
either root and has no cleanup, migration, or force flag.

The default launcher is accepted only when it is a Codex adapter. A non-Codex default requires an
explicit configured Codex `--launcher`; an unknown, duplicate, empty, or extra argument fails before
starting a process. The successful receipt names only the two generation ids and launcher profile, not
runtime paths or process credentials. A missing, dead, or ambiguous canonical root is a named refusal:
ordinary launch repair handles proven death, while ambiguity is never treated as permission to replace
traffic.
