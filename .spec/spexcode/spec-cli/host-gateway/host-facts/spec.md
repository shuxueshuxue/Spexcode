---
title: host-facts
status: pending
hue: 185
desc: Host-level runtime facts rendered once — `GET /host`, `spex doctor` at host scope, and the host card on the projects hub; project surfaces only link to them.
code:
  - spec-cli/src/host-facts.ts
related:
  - spec-cli/src/host.ts
  - spec-cli/src/doctor.ts
  - spec-cli/src/runtime-guard.ts
  - spec-cli/src/host-record.ts
  - spec-dashboard/src/ProjectsPage.jsx
  - spec-dashboard/src/projects.js
---
# host-facts

Some facts belong to the machine, not to any project: which runtime hosts the gateway (native Linux, macOS, or
WSL2 and its distro), node and tmux and git versions, which agent CLIs are installed and logged in, the launcher
wrappers the local config names and whether they resolve, and the memory envelope (a `.wslconfig` cap on Windows,
the enclosing cgroup elsewhere). Today these are diagnosed by hand — a 401 wave traced to a missing
`.spec/spexcode.local.json` launcher, a hung worker traced to a missing tmux — and by whoever remembers to look.

**Render once, at host level; link, never copy.** The gateway answers `GET /host` with those facts, computed
where the gateway runs so a WSL gateway reports WSL. `spex doctor` gains the same facts at host scope so a
terminal reads what the page reads. The projects hub ([[projects-hub]]) shows them as one host card above the
project rows, with a "run host doctor" action carrying the same honest result block the per-project doctor has.
A project's own surfaces show only consequences: a serve that failed because the host is not ready shows that
failure in its existing result block with a link to the host card, and project settings stay project-only —
a host fact copied into each project's settings would be duplicated everywhere and editable nowhere.

**The gateway publishes its own record.** Backends publish endpoint records; the host gateway did not, so a shell
or CLI wanting to attach had to guess a port. `spex dashboard` now writes a host record beside the project
records after its bind succeeds and removes only its own on a clean stop — the same instance-validated shape
[[host-gateway]] uses for backends, so a stale record degrades to "no gateway", never to a wrong one.

Browser and desktop read identical facts: a Windows user pointing a browser at the WSL gateway has the same host
and the same questions as the desktop user.

## current state

The host extension owns `GET /host` and `POST /host/doctor` behind the hub's admin scope. The response is one
stable projection: `runtime` (`native-linux`, `darwin`, or `wsl2` with `distro`), `versions` (`node`, `tmux`,
`git`), four `agents` rows (`installed` from PATH and `loggedIn` from each tool's local credential file),
`launchers` from the known projects' merged `.spec/spexcode.json` / `.spec/spexcode.local.json` profiles (including the
resolved binary or a broken resolution), and `memory` (WSL `.wslconfig` or the enclosing cgroup limit). No
credential check calls a network. `spex doctor --host` prints the same projection in a human-readable form;
the flag is documented in `spex help doctor`.

`spex dashboard` publishes `~/.spexcode/host.json` only from the listener's post-bind callback. The record is
`{version:1,url,pid,instanceId,startedAt}`; `readHostRecord` validates its shape, URL, and live PID, while
`dropOwnHostRecord` removes it only when the instance id still matches. A killed dashboard therefore leaves at
most a stale file that readers treat as absent. The ProjectsPage renders one host card above project rows,
reuses the existing transcript result block for host doctor, and links a serve failure to that card.
