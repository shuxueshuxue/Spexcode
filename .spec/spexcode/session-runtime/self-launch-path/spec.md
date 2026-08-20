---
title: self-launch database path
status: active
hue: 280
desc: Deterministic adopter-owned database path selection with no cwd, Git, project-state, or directory-creation fallback.
code:
  - packages/session-selflaunch/src/path.ts
related:
  - .spec/spexcode/session-runtime/adopter-cutin/spec.md
  - .spec/spexcode/session-protocol/sqlite-engine/spec.md
---
# self-launch database path

The self-launch adopter selects one database path before opening the protocol. Its fixed precedence is the explicit
CLI value, `SPEX_SESSION_DATABASE_PATH`, the `databasePath` string in the JSON file named by
`SPEX_SESSION_CONFIG`, then `${SPEXCODE_HOME:-$HOME/.spexcode}/sessions.sqlite`. An absent config selector means
there is no config-file read; it does not invent a project-local or implicit config location.

Every selected value must already be absolute. A relative value is refused as written and is never resolved against
the working directory. The resolver reads no Git metadata or project state, imports no Spex product package, and
creates no directory. A missing parent is refused before protocol open as `PROTOCOL_PATH_PARENT_MISSING`, preserving
the same repair path instead of turning a typo into a plausible new store or returning without a locality verdict.
