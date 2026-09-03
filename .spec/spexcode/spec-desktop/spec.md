---
title: spec-desktop
status: pending
hue: 25
desc: The desktop shell — a window over `spex dashboard`. A packaging of the existing product, never a second one.
code:
  - spec-desktop/main.js
related:
  - spec-desktop/desktop-integration.js
  - spec-desktop/gateway-discovery.js
  - spec-desktop/node-entry.mjs
  - spec-desktop/deep-link.test.js
  - spec-desktop/package.json
  - package.json
  - scripts/desktop-contract.test.mjs
  - scripts/desktop-pack.mjs
  - spec-desktop/electron-builder.config.cjs
  - spec-cli/src/host.ts
  - spec-cli/src/gateway-hub.ts
  - spec-cli/src/endpoint-record.ts
---
# spec-desktop

A desktop application that is **a window over the host gateway, and nothing else**. It finds a running
`spex dashboard` for this user or starts one as its child, loads that loopback origin in a `BrowserWindow`, and
adds operating-system integration the browser cannot: an application menu, a protocol handler, a native folder
picker, real windows. Because the page is the same dashboard dist the same gateway serves to a browser tab, the
SPA has **zero** desktop-specific code and no desktop build.

**The rule that keeps it honest.** Anything the desktop app can do, `spex dashboard` plus a browser must also be
able to do. The shell may add OS integration and may add nothing else. If a capability appears that only exists
inside the shell, that is the alarm, not the feature. This is [[self-launch-entry]]'s rule applied one layer up:
the dashboard reduces to the CLI path, and the desktop app reduces to the dashboard. The one exception is the
first-run page ([[desktop-windows-wsl]]): before a gateway exists there is no dashboard to load, so the shell
shows the bootstrap transcript itself — verbatim output, never a summary.

**The verb is `spex dashboard`, not `spex serve`.** An earlier spike aimed the window at `spex serve` plus
`spex serve ui` — the explicit one-backend pairing — and so owned a backend lifetime it should never have had:
every launch started a fresh backend, nothing stopped it, nothing reused it, and the project's single-owner
records ([[host-gateway]]'s endpoint record) were fought over by serves the human could not see. The host gateway
is already the multi-project face: it discovers every backend through instance-validated records, keeps the
durable catalog, starts an offline project's backend on demand as a **detached** `spex serve` that outlives the
gateway, and renders the project switcher ([[projects-hub]]). The shell therefore starts and stops **only the
gateway**. Backends behave exactly as on the web deployment: they outlive the window, and quitting the app stops
none of them. The cgroup containment the spike grew to reap leaked backends is retired with the leak; the
process the shell owns is a `utilityProcess` and dies with it.

**Attach before start.** If a host gateway is already listening for this user, the shell loads it rather than
starting a second; otherwise it starts one on a free loopback port and waits for its ready line. The shell reads
[[host-facts]]'s one `host.json` record through the CLI's shared `readHostRecord`, then probes that recorded
origin before attaching. There is no configured-port fallback and no second shell-owned record name: an absent,
stale, or mismatched record means start a new gateway and let its bind publish the new truth.

**One instance, one main window, real secondary windows.** The shell holds the single-instance lock so a second
launch — or a deep link ([[desktop-deep-link]]) — focuses the existing window instead of racing it. The main
window carries the project switcher; a tab torn out of the strip ([[tab-strip]]) opens as its own
`BrowserWindow` through the SPA's ordinary `window.open`, so the same gesture yields a popup in a browser and a
window here. Same-origin opens become windows; every off-origin link goes to the user's real browser.

**The application menu owns the macOS ⌘W and ⌘1–9 accelerators.** Menu accelerators are the native, reliable
route for ⌘ chords and make these tab actions discoverable in the Window menu. Each menu item injects the
equivalent cancelable `KeyboardEvent` into the focused page, where the ordinary keymap ([[keyboard-service]])
and tab APIs decide the action; the SPA has no Electron branch. Whether an unclaimed ⌘ chord would otherwise
reach the page is not established. On Linux, where the browser delivers Ctrl chords to the page, the menu
remains unchanged. Quit, copy/paste, zoom and the platform's standard items remain.

**Native folder picker, existing route.** "Add project" in the desktop opens the OS folder dialog and posts the
chosen path as `{root}` from the main process to the gateway's existing `POST /projects`, then navigates the main
window to the returned project id; no preload or renderer privilege is involved, and the browser keeps its
read-only directory browser. `SPEXCODE_DESKTOP_TEST_PICK_DIRECTORY` is the test-only dialog seam: when set it
supplies the fixture path while the HTTP request and catalog write remain real. On Windows the dialog browses the
WSL filesystem and the path is translated ([[desktop-windows-wsl]]).

**Platforms.** Linux and macOS run the gateway natively. On macOS a GUI-launched gateway runs inside the user's
Aqua session and the backend can read the login keychain directly (the measured `Claude Code-credentials` item was
readable from `gui/501`). That alone does not make a plain `claude` launcher authenticate: on the measured Mac mini
the worker still reported `Claude.ai login was rejected` / `Not logged in`, so the failure is in the launcher's
token/auth path rather than keychain access. The shell does not claim to replace login or a credential-sync agent.
Windows runs the gateway inside WSL2 ([[desktop-windows-wsl]])
because the session runtime needs tmux, bash and unix sockets; a native Windows runtime waits on [[session-host]].

**Why it lives outside the root workspaces.** Electron is ~150 MB of runtime. Placing this package in the
workspace list would put that download in front of every contributor who runs `npm install`. It is installed on
its own: `npm run desktop:install`, `npm run desktop:start`; `npm run desktop:check` verifies the entrypoints and
the optional-workspace boundary. These are developer integration, not a claim that signed installers exist;
packaging and distribution tiers are a later slice, and the signed build must keep Electron's `runAsNode` fuse
enabled because the CLI re-spawns itself through `process.execPath`.

**Where `ELECTRON_RUN_AS_NODE` is set decides whether the app starts at all.** The CLI re-spawns itself through
`process.execPath`, which under Electron is the Electron binary, so it needs the flag to come back up as Node.
Putting the flag in the utility process's own env makes Electron read its Chromium switches as Node options and
exit with `bad option: --type=utility`; `execArgv` is reported, never executed. The placement that works is inside
the child at runtime — the utility entry is a shim that sets the variable and then imports the CLI, so the flag
reaches exactly the processes that child spawns.

**The child's environment is scrubbed, not inherited whole.** A shell launched from a backend inherits that
backend's `PORT`, `SPEXCODE_API_URL` and `SPEXCODE_PROJECT_ROOT`; passed through, they would point the gateway at
another project's endpoint. The routing variables are dropped at the fork.

**Quitting is unconditional, including on macOS.** A resident process whose only purpose is to host a window it
no longer has is not a feature; with the backends detached there is nothing to keep alive.

Phase-one packaging is [[desktop-packaging]]: an unsigned electron-builder bundle carries the root and every
`@spexcode/*` workspace from one monorepo commit, with built dist and production dependencies under
`extraResources`. Linux AppImage/deb are the measured targets; dmg/nsis declarations exist for later lanes.

The window is chrome-only in the other sense too: system-coloured to the board's own paper so there is no white
flash before first paint, retrying the initial load because a listener and its first accepted connection are not
the same instant. Renderer isolation stays at the defaults — context isolation on, node integration off, sandbox
on — and `webSecurity` is never relaxed: a loopback origin is already a secure context.
