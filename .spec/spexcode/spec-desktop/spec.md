---
title: spec-desktop
status: pending
hue: 25
desc: The desktop shell — a window over `spex serve`. A packaging of the existing product, never a second one.
code:
  - spec-desktop/main.js
related:
  - spec-desktop/node-entry.mjs
  - spec-desktop/package.json
  - package.json
  - scripts/desktop-contract.test.mjs
---
# spec-desktop

A desktop application that is **a window and a child process, and nothing else**. It picks a free loopback
port, starts the existing CLI in the project directory, and loads that origin in a `BrowserWindow`. Because
the page is served by the same process a terminal user starts by hand, over the same origin, the dashboard
needs **zero** desktop-specific code.

The optional shell is reachable from the repository root through `npm run desktop:install` followed by
`npm run desktop:start`; `npm run desktop:check` verifies these entrypoints and the optional-workspace boundary.
Electron remains outside the root workspaces by design, so browser-only contributors do not install the desktop
runtime. These entrypoints are developer integration, not a claim that signed installers or a release channel
exist.

**This node began as a measured spike, and the sections below preserve those measurements.** Boot, port hand-off,
and window load work: the window loads first try in about two seconds, and the load retry never fires. The two
spike failures are now repaired by selecting the existing gateway origin and adding Linux process containment.

The dashboard proof used a one-node demo project, so the real project's roughly 90-second cold `/api/graph` build
was not covered; a long initial "loading specs from git…" state is graph cost, not a desktop-shell defect.

**Which origin serves the dashboard was got wrong, and the correction is not a detail.** `spex serve`'s `/`
is a plain-text index of API routes; the backend serves no static bundle, so a shell pointed at it renders a
line of text where a board should be. The dashboard dist is served by the **gateway** — `spex serve ui`, and
the same gateway the supervisor already starts on its public branch with a `distDir`. So the shape "one
loopback origin serving the bundle and proxying `/api`" is not something this node must invent; it exists, and the
shell was aimed one process to the left of it. The shell now starts that existing pair: `spex serve --port P` for
the project backend and `spex serve ui --port Q --api-port P` for the loopback dashboard origin, then loads Q.
This is the smallest honest choice: making `spex serve` serve static files would change the CLI contract for every
terminal and browser user, while the gateway already is the product's explicit one-backend pairing.

**The rule that keeps it honest.** Anything the desktop app can do, `spex serve` plus a browser must also be
able to do. The shell may add operating-system integration — a window, a project picker, a tray, an
updater — and may add nothing else. If a capability appears that only exists inside the shell, that is the
alarm, not the feature. This is [[self-launch-entry]]'s rule applied one layer up: the dashboard reduces to the CLI
path, and the desktop app reduces to the dashboard.

**Why it lives outside the root workspaces.** Electron is ~150 MB of runtime. Placing this package in the
workspace list would put that download in front of every contributor who runs `npm install`, including
everyone who will never touch the shell — an install-surface tax paid by people who receive nothing for it.
It is installed on its own, from its own directory.

**The child is a `utilityProcess`, not a spawned command** — a Chromium Services child, so it dies with the
browser process even under `SIGKILL`, and it is unaffected by the `runAsNode` fuse that any hardened build
disables.

**But that guarantee stops at the child, and an earlier draft of this node claimed otherwise.** Measured:
after `kill -9` on the shell, the utility process does die — and the backend's own `child_process.spawn`
grandchildren reparent to init and go on holding the port. An ordinary quit leaks one too. So the sentence
"a crashed shell cannot leave a server holding the port" was false, and the reason it was false is
instructive: process-tree bookkeeping is defeated by reparenting, which is exactly the case that matters.
Reaping needs a mechanism that reparenting cannot escape. On Linux the node shim enters each service into a
`systemd-run --user --scope` cgroup whose `KillMode=control-group` owns the service; an in-scope watchdog observes
the utility process and writes `1` to that cgroup's `cgroup.kill` after the utility is killed, so reparenting to init
does not change membership. The Linux adapter requires the user's systemd bus (`XDG_RUNTIME_DIR` and
`DBUS_SESSION_BUS_ADDRESS`)
and fails loudly when it cannot create a scope. Windows has no implementation yet (the intended seam is a Job Object
with `KILL_ON_JOB_CLOSE`); macOS has no equivalent kernel primitive in this package, so those platforms retain the
measured leak and are named as unsupported rather than given a process-tree approximation.

**Where `ELECTRON_RUN_AS_NODE` is set decides whether the app starts at all.** The backend re-spawns itself
through `process.execPath`, which under Electron is the Electron binary, so it needs the flag to come back
up as Node — and the first such re-spawn is not the supervisor but the CLI entry's own last line. Putting
the flag in the utility process's **own env** does not merely fail to help: Electron launches that process
as `electron --type=utility --utility-sub-type=node.mojom.NodeService …`, the flag makes the binary read
those Chromium switches as Node options, and it exits with `bad option: --type=utility` before anything
runs. `execArgv` is not an escape either — Electron reports the values in `process.execArgv` and never
executes them. The placement that works is inside the child at runtime, which is why the utility process
entry is a shim that sets the variable and then imports the CLI: from there it reaches only the processes
that child spawns, which is precisely the set that needs it.

**Port selection is a guess plus a retry, and says so.** The shell asks the operating system for a free port
and hands it to the backend, which is a time-of-check/time-of-use race: the port can be taken in between. On
a single-user desktop binding loopback the window is microseconds, and the retry — a fresh port on a bind
failure, a bounded number of times — is what actually closes it, rather than a claim that the race is not
there. The alternative, having the backend bind port zero and report what it got, is the better shape and is
not yet available: `PORT=0` is swallowed by the supervisor's `|| 8787` default, and the ready line prints the
*requested* port rather than the bound one, so a zero-port launch would announce `:0`.

**The child's environment is scrubbed, not inherited whole.** A shell launched from a backend inherits that
backend's `PORT`, `SPEXCODE_API_URL`, and `SPEXCODE_PROJECT_ROOT`; passed through, they would point this
project's serve at another project's endpoint record. The routing variables are dropped at the fork.

**Quitting is unconditional, including on macOS.** The usual platform exception keeps an application
resident with no windows; here that means a backend still holding a port, so the next launch races itself. A
process whose only purpose is to host a window it no longer has is not a feature.

The window is chrome-only in the other sense too: system-coloured to the board's own paper so there is no
white flash before first paint, retrying the initial load because a listener and its first accepted
connection are not the same instant, and handing every off-origin link to the user's real browser rather
than opening it in an app window with no address bar. Renderer isolation stays at the defaults — context
isolation on, node integration off, sandbox on — and `webSecurity` is never relaxed: a loopback origin is
already a secure context, so nothing needs to be given up to serve from one.
