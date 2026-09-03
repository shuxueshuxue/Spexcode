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
wrappers the local config names and whether they resolve. Today these are
diagnosed by hand — a 401 wave traced to a missing `.spec/spexcode.local.json` launcher, a hung worker traced to a
missing tmux — and by whoever remembers to look.

**A host fact is a fact about the machine, and every rendering says something true of it — and a fact nobody
acts on is not worth rendering at all.** Three ways to fail that are known, all of them learned from the same
row. A fact keyed on a MECHANISM reports the mechanism's absence as a defect: a memory row naming
`.wslconfig`/cgroup and whether that file was found said `unknown: missing` on a Mac, which reads like a broken
dependency about a host that simply caps nothing. Reporting the cap as a cap fixed the lie but not the row: an
operator reading this card is deciding whether the machine can host work at all, and a number they cannot act on
from here is noise on the one surface that must stay scannable — so **the memory envelope is not a host fact this
product renders**, and no cgroup or `.wslconfig` reading feeds it. Per-process resource ownership is a different
question, asked deliberately by [[host-resource-budget]] through `spex session resources`, which reads `/proc` and
answers about the sessions that exist rather than about a limit the host might set. And a per-PROJECT fact is not
a host fact: launcher profiles belong to one project's config, so the cross-project card names only what the
machine answers for every project — whether each agent CLI resolves here at all — while per-project launcher
resolution stays a DIAGNOSIS, printed by `spex doctor --host` into the same result block the card's own action
fills.

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
and `launchers` from the known projects' merged `.spec/spexcode.json` / `.spec/spexcode.local.json` profiles
(including the resolved binary or a broken resolution). There is no memory field: `collectHostFacts` reads no
cgroup and no `.wslconfig`, and `formatHostFacts` prints no cap line. No credential check calls a network. `spex doctor --host` prints the same projection in a human-readable form;
the flag is documented in `spex help doctor`.

`spex dashboard` publishes `~/.spexcode/host.json` only from the listener's post-bind callback. The record is
`{version:1,url,pid,instanceId,startedAt}` plus an optional `peerPort` naming the gateway's always-loopback peer
ingress ([[gateway-auth]]'s second door); the one publish waits until both doors are bound, so an absent `peerPort`
means this gateway offers no machine entry and never means "not published yet";
`readHostRecord` validates its shape, URL, and live PID and drops a malformed `peerPort` to absent, while
`dropOwnHostRecord` removes it only when the instance id still matches. A killed dashboard therefore leaves at
most a stale file that readers treat as absent. The ProjectsPage renders one host card above project rows —
toolchain and agent CLIs — reuses the existing transcript result block for host doctor, and links a serve
failure to that card. The card carries neither a memory row nor launcher rows: the memory envelope is gone from
every rendering, and `formatHostFacts` keeps the per-project launcher listing on the CLI's host diagnosis, which
that block already shows on demand.
