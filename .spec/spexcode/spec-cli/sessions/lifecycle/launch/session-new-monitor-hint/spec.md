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
verb's syntax, output, side effects and blocking behaviour. It does not prescribe an orchestration workflow.
The full `spex session` / `spex help session` drawer remains intact. Both views
are rendered from one shared session-help definition, so wait's edge semantics, watch's never-exit warning,
send's append-backed text and raw-key warning, quarantine's exact-witness/restore-id rule (including that `--thread` is an adapter-native
conversation id rather than the SpexCode session id, and is omitted for Claude), selector grammar, and project-bound write warning cannot drift between a drawer
manual and copied verb manuals. Existing session verbs and spellings keep their behaviour; this is a help
projection change only. The declaration entries project [[state]]'s current vocabulary rather than inventing
another lifecycle: `done --propose merge` means review and the sole clickable merge proposal, `nothing` is an
intended no-write trap that sends the agent to merge, close, ask, or park, `close` means close-pending only for
settled work with no outstanding human decision, follow-up, or inspection, while `ask` includes a reported
finding/recommendation or handoff awaiting human direction and `park` retains its distinct self-wake owner.
The merge entry also says that the configured candidate-against-main [[review-acceptance]] gate runs
automatically; help advertises that non-optional declaration behavior without duplicating its suite, cache, or
attribution policy.

`spex session new --help` lists its optional `--name <name>` alongside the prompt and launcher inputs. The
name is the new record's initial display override; it does not enter, replace, or alter the launch prompt.
It also lists `--base <commit-ish>`, which pins the new worktree's fork point instead of taking the
source-of-truth branch's current head ([[sessions-core]]); help names the input and its refusal-before-creation
guarantee, and leaves the resolution contract to that owner.

Worker-only live-reference entries keep the same map: `session files add|ls|retract` names live file paths and
`session web add|ls|retract` names live loopback web URLs ([[files]] / [[web]]). Their own nouns own format and
gateway policy; this shared drawer tells an agent the capability exists without turning help into another guide.

The manager recovery entry, `session reparent <child-SEL...> --to <parent-SEL>`, names its required destination
and batch shape without prescribing a recovery workflow. Its promise to rewrite the parent pointer and managed
watch relation belongs to [[session-reparent]]; help only makes the operation discoverable alongside the other
manager controls.

One word — **close** — sits on both sides of the manager/worker split, so each entry states which side it is
on in its own text instead of leaning on the drawer's grouping. `session close <SEL>` says it retires ANOTHER
session and that its selector is never `.` and never the caller's own id; `done --propose close` says it only
PROPOSES, the human performing the close. The drawer's headings are a layout, and a reader who arrives at one
entry through `session close --help` never sees them — a help projection that leaves the distinction to
inference is what lets an agent read the destructive verb as its own ending.

The same shared map projects [[machine-peer]]'s remote spellings for `session show`, text `session send`,
`session close`, `session ls`, and `session new`: each takes `--ssh <address> <full-session-id>` (send and new
also take their text payload). With `ls` and `new`, the id anchors project derivation and does not select or
parent the newly created row. Live-pane capture and raw-key control remain absent from that peer surface. Help
records that bounded transport choice without discovering machines, opening SSH, or prescribing a
cross-machine workflow.

**The successful-create receipt.** After [[launch]] returns the new session record, `spex session new`
prints the bare, parseable session **JSON to STDOUT** exactly as before, then prints a concise receipt to
**STDERR**. The receipt carries the real session id and one line for each dependency:

- **current result** — the session JSON is on stdout now, and `spex session ls <id>` is the later one-shot
  snapshot;
- **next lifecycle change** — a governed parent automatically installs the child's `parent` watch source after
  creation, first delivering the child's current-state snapshot and then every declared state except routine
  working. `spex session reparent <id> --to <parent>` moves that source; `watch cancel` affects only an independent manual watch. A caller without a governed session
  address backgrounds `spex session wait <id>` to observe a non-actionable to actionable edge and exits as the
  wake-up. `spex session watch stream <id>` is the continuous human stream and never exits;
- **response channel** — `spex session send <id> "<msg>"` is the ordinary path and succeeds once it appends
  the message to the target timeline; an unavailable adapter may delay the target context but does not undo
  that send. `send --keys` remains an unstable last resort only after plain text cannot reach the needed TUI
  control.

The receipt is the same harness-agnostic dependency model for every caller. It does not diagnose
launcher/provider failures, prescribe a supervisor workflow, require child sessions, change lifecycle
states, or add a command. Those concerns remain in their existing adapter and product boundaries.

The managed-watch outcome is resolved before that receipt is printed. A child that was created but whose
parent subscription could not be installed remains a real child session; the command says that failure loudly
and prints the unmanaged background-`wait` receipt rather than falsely claiming terminal delivery. Retrying
the ordinary `spex session watch <id>` is the explicit repair, not a second create path.

A peer-created session is not that local child case. Its JSON still reaches stdout, but its stderr receipt names
the peer spelling for a later snapshot and explicitly says that no managed watch exists across the machine
boundary. The remote prompt's reply hint is the return path; a local `session wait` or `session watch` is not
misrepresented as a monitor for the remote row. The session list describes live rows in its heading. An explicit
id absent from that live list is resolved through archived state and the terminal-close ledger before it is called
a named miss.
