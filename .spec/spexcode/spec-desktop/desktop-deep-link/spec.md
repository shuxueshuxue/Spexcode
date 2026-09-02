---
title: desktop-deep-link
status: pending
hue: 35
desc: `spexcode://` deep links — the tab strip's address grammar under a scheme the OS routes to the running window; `spex open` is the CLI twin.
related:
  - spec-desktop/main.js
  - spec-dashboard/src/route.js
  - spec-dashboard/src/tabs.js
  - spec-cli/src/cli.ts
---
# desktop-deep-link

Every dashboard document already has an address — [[tab-strip]]'s `page + param + query` grammar under
`/p/<projectId>/`. A deep link is that same path under the `spexcode://` scheme: `spexcode://p/<projectId>/<address>`
opens or focuses the desktop app and navigates its main window there. The browser fallback is the plain
`http://` URL of the same gateway; nothing in the SPA knows which scheme brought the user.

**Registration and routing are the shell's.** The shell registers as the scheme's handler and holds the
single-instance lock ([[spec-desktop]]); macOS delivers a link through the `open-url` event, Windows and Linux
through a second instance's argv. In both cases the handler maps the link onto the gateway origin, focuses the
existing window and navigates it — a link never spawns a second app.

**`spex open` is the terminal twin.** `spex open <node|session|path>` resolves the target's address, prints the
`http://` URL, and hands it to the platform opener so the user's default browser — or the desktop app when it
owns the scheme — shows it. Issues, remarks and hook output can therefore carry a link a human clicks.

An unknown project id or a malformed address is a loud navigation to the projects hub with the reason shown,
never a silent no-op.
