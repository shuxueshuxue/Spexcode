---
title: web
status: active
hue: 196
desc: A session-owned list of live local web services that the dashboard previews through its own gateway.
code:
  - spec-cli/src/session-web.ts
related:
  - spec-cli/src/cli.ts
  - spec-cli/src/help.ts
  - spec-cli/src/guide.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/gateway.ts
  - spec-cli/src/gateway-hub.ts
  - spec-cli/src/session-web.api.test.ts
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/icons.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/i18n/en.js
  - spec-dashboard/src/i18n/zh.js
  - spec-dashboard/test/session-web.e2e.mjs
  - .spec/spexcode/.plugins/core/spec.md
---
# web

An agent can hand a running local website to the human as a live session reference. A session owns one
global-store `web.json` beside its `session.json`; its JSON array of canonical loopback HTTP URLs is the
whole durable state. Posting records only a URL. It does not connect, copy, start, stop, stage, or upload
the web service, so every preview request reaches the process and bytes that exist at that moment.

## one list, three operations

The worker porcelain is `spex session web add <url>`, `spex session web ls`, and `spex session web retract
<url>`. `add` parses and canonicalizes one `http://127.0.0.1:<port>/...`, `http://localhost:<port>/...`, or
`http://[::1]:<port>/...` URL without making a network request; `ls` reads the list; and `retract` removes
the same canonical URL. A port is required. The loopback-only rule lets the gateway forward to a process on
this machine while an exact published entry, not a visitor-supplied URL, remains the authorization boundary.

The references are deliberately host-local. Reopening the session on another machine leaves its list intact,
but the corresponding local port normally does not exist there and preview reports the upstream as
unavailable instead of silently reaching a different service.

## same-origin, live proxy

The dashboard gateway serves a posted URL at `/web/<session>/<key>/...` in a single-project dashboard and
at `/p/<project>/web/<session>/<key>/...` in the host dashboard. `key` is derived from the exact canonical
entry; it selects only an entry in the session list. Before dialing loopback, the gateway reloads the list
and rejects an unknown key with a named `403`; a guessed route therefore cannot become access to an arbitrary
port. A currently missing or stopped posted service returns a named `502` while remaining visible as an honest
live reference.

The prefix is stripped before forwarding and the shared HTTP transport streams request and response bytes;
the matching WebSocket upgrade path uses the same current entry and paired socket lifecycle. The browser sees
the gateway's own scheme, host, and port, so the preview iframe crosses no CORS or mixed-content boundary.
The service must be capable of running below its assigned prefix: relative resource URLs work directly, while
an application hard-coding root-absolute asset, navigation, or HMR URLs needs its normal base-path
configuration. This is an explicit framework constraint rather than brittle HTML/JavaScript rewriting by the
gateway.

## resource tabs

The session toolbar keeps its Terminal/Conversation tab and adds local resource tabs. Its tab group's trailing
plus button lists the current session's posted files and web services that do not already have a tab; choosing
one opens exactly one tab for that session and reference. Closing a tab removes only this browser-local view;
the plus menu may reopen it, but never creates a duplicate. The existing top-right files control remains a
separate compact list and pop-out preview route.

When a graph update first observes `spex session web add` for a live session, the dashboard creates its one
web resource tab automatically and selects it only when that session is already selected. A resource tab has a
refresh tool: files reload their current bounded preview response, and webpages recreate the same-origin iframe
so the current local service response is requested again. Removing a published reference closes its matching
tab because its authorization has been withdrawn.

## agent awareness

The materialized agent contract is sourced by [[core]] and carries one short operational line: after starting
a human-facing local web service, publish its loopback URL with `spex session web add <url>`. `spex guide web`
teaches the exact URL shape and explains that the service must stay running for the live preview.
