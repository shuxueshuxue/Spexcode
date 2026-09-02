---
title: desktop-deep-link
status: pending
hue: 35
desc: `spexcode://` deep links — the tab strip's address grammar under a scheme the OS routes to the running window; `spex open` is the CLI twin.
code:
  - spec-desktop/deep-link.js
related:
  - spec-desktop/main.js
  - spec-desktop/desktop-integration.js
  - spec-desktop/deep-link.test.js
  - spec-cli/src/open-dashboard.ts
  - spec-cli/src/open-target.ts
  - spec-dashboard/src/route.js
  - spec-dashboard/src/tabs.js
  - spec-cli/src/cli.ts
  - spec-cli/src/help.ts
  - spec-cli/src/open-dashboard.test.ts
  - spec-cli/src/open-target.test.ts
---
# desktop-deep-link

Every dashboard document already has an address — [[tab-strip]]'s `page + param + query` hash grammar under
`/p/<projectId>/`. A deep link is that same canonical hash under the `spexcode://` scheme:
`spexcode://p/<projectId>/#/spec/<node>` (or another registered dashboard page)
opens or focuses the desktop app and navigates its main window there. The browser fallback is the plain
`http://` URL of the same gateway; nothing in the SPA knows which scheme brought the user.

**Registration and routing are the shell's.** The shell registers as the scheme's handler and holds the
single-instance lock ([[spec-desktop]]); macOS delivers a link through the `open-url` event, Windows and Linux
through a second instance's argv. A cold argv or pre-ready macOS event waits for the gateway and main window.
In every case the handler reads the live catalog, maps a known project plus a structurally valid registered-page
address onto the gateway origin, focuses the existing window and navigates it — a link never spawns a second app.
On macOS the scheme is claimed only by a packaged `.app` bundle whose `CFBundleURLTypes` declares it; an
unpackaged Electron development binary cannot be opened by Launch Services, so dev proof uses a direct
second-instance invocation with the URL argument and packaged builds require a separate re-measurement.

An unpackaged development launch registers `process.execPath` with the resolved application entry argument so the
OS invokes this shell rather than Electron's default app; packaged builds use the installed application handler.

**`spex open` is the terminal twin.** `spex open <node|session|path>` reads [[host-facts]]'s live `host.json`,
validates its instance against `GET /host`, and matches the current project's main root against the gateway
catalog. It resolves an exact node id first, then a session selector, then an existing file within that project;
prints the resulting HTTP(S) `/p/<projectId>/` URL; and hands it to `xdg-open`, `open`, or Windows `start` unless
`--print-only` was given. An ambiguous selector, missing/outside path, absent gateway, or project the gateway
does not know fails loudly. Issues, remarks and hook output can therefore carry a link a human clicks.

An unknown project id or a malformed address is a loud navigation to `/projects?notice=<reason>`, where
[[projects-hub]] consumes the generic one-shot notice parameter through its existing transient-notice surface
and removes it from browser history. The SPA knows neither the custom scheme nor Electron; failure is never a
silent no-op.
