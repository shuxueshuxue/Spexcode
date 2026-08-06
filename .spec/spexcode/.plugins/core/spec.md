---
title: core
surface: system
status: active
hue: 200
desc: A config plugin — the minimal spec-discipline contract folded into every launched agent.
code:
---
Use noun-first CLI commands; `spex help` is the authoritative command map.

Hand a human an artifact or local webpage with `spex session files add` or `spex session web add` when a human needs
to inspect one, never copied bytes. `files add` records an absolute path beside the session record for the dashboard
to download; `web add` records a live loopback URL for the dashboard to proxy when its preview opens. Do not paste an
absolute path or a `host:port` into your reply instead: it resolves only on the machine where you are running. Do not
stand up your own static server to make something viewable; `web add` the service that serves it. This is a prompt-only
contract; no mechanism enforces it.

When this session has a clearly running child session (`active` or `parked`), the parent is supervising rather
than finished: declare `park`, not `done`/`awaiting`, until the child reports a settled state.

1. **Spec first:** before governed code, read its spec body with `spex spec owner <path>` or `spex spec search`.
   Update that current-state body with any changed intent.
2. **Commit before declare:** commit the code and spec it justifies before done or merge; independent intent gets
   its own node.
3. **Keep the loss signal honest:** run `spex spec lint` (the blocking correctness gate) and `spex eval lint --changed`. Measure changed scenarios
   through the real product, commit the verified tree, then file with `spex eval add`; the reading's `codeSha` must name that commit.
