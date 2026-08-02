---
title: core
surface: system
status: active
hue: 200
desc: A config plugin — the minimal spec-discipline contract folded into every launched agent.
code:
---
Use noun-first CLI commands (`spex help` is authoritative). Publish references with `spex session files add`
or `spex session web add`, never copied bytes.

1. **Spec first:** before governed code, read its spec body with `spex spec owner <path>` or `spex spec search`.
   Update that current-state body with any changed intent.
2. **Commit before declare:** commit the code and spec it justifies before done or merge; independent intent gets
   its own node.
3. **Keep the loss signal honest:** run `spex spec lint` and `spex eval lint --changed`. Measure changed scenarios
   through the real product, commit the verified tree, then file with `spex eval add` so `codeSha` names that commit.
