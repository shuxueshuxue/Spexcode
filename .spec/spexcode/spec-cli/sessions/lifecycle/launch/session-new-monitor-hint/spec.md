---
title: session-new-monitor-hint
status: active
hue: 280
desc: Session verbs are discoverable before use, and a successful new receipt names the current result, next lifecycle change, and response channel without corrupting stdout JSON.
code:
  - spec-cli/src/help.ts#sessionHelpDefinitions
  - spec-cli/src/help.ts#sessionDrawerHelp
  - spec-cli/src/help.ts#sessionVerbHelp
  - spec-cli/src/help.ts#commandHelp
  - spec-cli/src/help.ts#sessionLaunchReceipt
related:
  - spec-cli/src/cli.ts
  - spec-cli/src/session-help-cli.test.ts
  - spec-cli/src/session-create-cli.test.ts
---

# session-new-monitor-hint

## raw source

Session coordination has two discoverability moments. Before a command runs, a caller probing
`spex session <verb> --help` needs that verb's exact behaviour, not the complete session drawer repeated
for every probe. After `spex session new` succeeds, the caller needs a compact receipt that says what result
exists now, which existing command observes the next lifecycle change, and which existing command carries a
response. Both are CLI projections of the mechanisms that already exist; neither invents a workflow or a
new primitive.

## expanded spec

**Exact noun-verb help.** `spex session <verb> --help` is intercepted before dispatch and prints only that
verb's usage and behaviour. The full `spex session` / `spex help session` drawer remains intact. Both views
are rendered from one shared session-help definition, so wait's edge semantics, watch's never-exit warning,
send's raw-key warning, selector grammar, and project-bound write warning cannot drift between a drawer
manual and copied verb manuals. Existing session verbs and spellings keep their behaviour; this is a help
projection change only.

**The successful-create receipt.** After [[launch]] returns the new session record, `spex session new`
prints the bare, parseable session **JSON to STDOUT** exactly as before, then prints a concise receipt to
**STDERR**. The receipt carries the real session id and one line for each dependency:

- **current result** — the session JSON is on stdout now, and `spex session ls <id>` is the later one-shot
  snapshot;
- **next lifecycle change** — background `spex session wait <id>` observes a non-actionable to actionable
  edge and exits as the wake-up, while `spex session watch <id>` is the continuous stream and never exits;
- **response channel** — `spex session send <id> "<msg>"` is the ordinary path, while `send --keys` remains
  an unstable last resort only after plain text cannot land.

The receipt is the same harness-agnostic dependency model for every caller. It does not diagnose
launcher/provider failures, prescribe a supervisor workflow, require child sessions, change lifecycle
states, or add a command. Those concerns remain in their existing adapter and product boundaries.
