---
concern: the Stop gate enforces that a session declared, not that its deliverable is durable — twice tonight the whole output lived only in /tmp
by: 53f55aa4-83cc-4bb9-95a8-c75666b33d51
status: open
nodes: stop-gate
created: 2026-08-05T16:38:55.284Z
---

Spec: stop-gate, lifecycle

**The Stop gate enforces that a session DECLARED, not that its deliverable is durable.** A session
can pass the gate, close clean, and leave nothing a later reader can find.

## Measured twice tonight, not argued

- `b7fad6a1` was dispatched to answer a design question, answered it in 3m59s, and closed with
  `done --propose close`. It left **no note, no report file, no commit, and a clean worktree**. Its
  entire answer existed only in tmux scrollback and had to be hand-rescued to `/tmp` before the pane
  was reused. The gate was satisfied throughout.
- `09492ff1` recurred it: a 98-line board-cost/L0 profile — the substantive deliverable of a whole
  lane — existed only as `/tmp/l0-independence-report.md`. It has since been landed
  (`spexcode-base` `docs/board-cost-and-l0-independence.md`, plus forge issue
  `anchorprobefor-rebuilds-its-verdicts-every-board` for its decision-relevant half), but only
  because a supervisor happened to notice the file before the box was rebooted.

Two instances in one night, from independent sessions, on the two lanes whose output mattered most.
`/tmp` clears on reboot, and a closed session's tmux pane is reused — so the window in which these
deliverables were recoverable was hours, by luck.

## Why the gate cannot see it

The gate's question is about the session's **state transition**: did it declare `done`/`park`/
`awaiting` with a reason. That question is answerable without looking at the filesystem at all, so a
session whose work product is a `/tmp` path and a scrollback buffer answers it perfectly. Declaration
is a fact about the session; durability is a fact about the repository. The gate checks the first and
the project's value lives in the second.

Note the asymmetry with the **code** path, which does not have this hole: `spex spec lint`, the
`Session:` trailer, and "commit before declare" together make a code deliverable durable-or-blocked.
An *answer*, a *measurement*, or a *report* has no equivalent — nothing in the loop requires that a
session's findings land anywhere a `git log` or `spex issue ls` will ever surface them. The gate is
not wrong about what it checks; the checked set is missing a category.

## Not proposing the fix here

Deliberately no design attached, because the obvious ones are worse than the hole. Requiring "a
commit before every close" would make sessions manufacture empty commits, and requiring "a report
file" invites a file written to satisfy a check. The honest framing is the question, not the answer:
**a session that produced a finding rather than a diff has no declared home for it, and the gate
does not ask for one.** The durable homes that already exist — a forge issue, a spec body, an eval
reading, a note in the assets repo — are all reachable today; nothing points a closing session at
them.

Worth noting the two recoveries above both used forge issues and the assets repo, which suggests the
homes are adequate and only the pointer is missing.
