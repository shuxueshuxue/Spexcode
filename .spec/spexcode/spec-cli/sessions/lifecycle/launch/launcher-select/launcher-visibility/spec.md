---
title: launcher-visibility
desc: The dashboard keeps headless harness launchers out of its New Session picker by default, while config can reveal them and CLI launcher selection remains complete.
hue: 280
related:
  - spec-cli/src/harness.ts
  - spec-cli/src/layout.ts
  - spec-cli/src/index.ts
  - spec-cli/src/guide.ts
  - spec-cli/templates/spexcode.json
  - spec-cli/src/harness.test.ts
  - spec-cli/src/init.test.ts
  - spec-dashboard/src/launch.js
  - spexcode.json
---

# launcher-visibility

The dashboard's New Session picker is a focused interactive-launch surface, not an inventory of every
configured execution profile. A launcher whose [[harness-adapter]] declares itself headless stays a real,
resolvable [[launcher-select]] profile, but is hidden from that picker by default so non-interactive adapters
do not crowd the ordinary launch choice.

Headlessness is one explicit boolean capability on every `Harness` adapter. It is never inferred from a
launcher name, command, or harness id, and every adapter declares the value. The launcher projection exposed
through `GET /api/settings` derives that capability from the resolved adapter and applies the dashboard
visibility policy. `dashboard.showHeadlessLaunchers: true` reveals headless rows; absent or `false` hides them.
The setting is portable project policy and belongs in committed `spexcode.json`; `spex init` plants the
explicit `false` default and `spex guide settings` documents its ownership and effect.

This policy changes visibility only. The CLI and session-create backend continue to resolve the complete
configured launcher map, so `spex session new --launcher <name>` can explicitly select any launcher,
including a hidden headless one. The dashboard consumes the filtered settings projection; it does not grow
a harness-specific branch or delete the underlying launcher.
