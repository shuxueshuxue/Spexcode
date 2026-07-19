---
title: gateway-hub
hue: 150
desc: One gateway fronting every project backend on the machine — /projects to manage, /p/:projectId/* proxied to that project's loopback backend.
code:
  - spec-cli/src/gateway-hub.ts#startHubGateway
  - spec-cli/src/gateway-hub.ts#listHubProjects
related:
  - spec-cli/src/gateway-auth.ts
  - spec-cli/src/login-page.ts
  - spec-cli/src/supervise.ts
  - spec-cli/src/gateway-hub.test.ts
---
# gateway-hub

Where [[public-mode]] exposes ONE project behind one password, the hub is the **multi-project face**: a
single gateway fronting every `spex serve` this user runs, so one public endpoint serves many projects
without duplicating TLS, login, or exposure decisions per project. The backends stay untouched loopback
internal services; the hub owns the outside.

**The route contract** — two surfaces, one authorization mechanism ([[gateway-auth]]):

- `/projects` — the admin surface: list the registry (`GET`, with gating state), and set/clear passwords
  (`PUT`/`DELETE /projects/admin-password`, `PUT`/`DELETE /projects/:id/password`) — the APIs the future
  admin UI drives. Admin scope required; with no admin password, loopback only.
- `/p/:projectId/*` — the project surface: `login`/`logout` are the hub's own (the designed login page,
  parameterized), everything else is reverse-proxied to that project's backend with the `/p/:projectId`
  prefix stripped, WebSocket upgrades included. Admin or matching-project scope, or open when ungated.
- `/login`, `/logout` — the admin session, same designed page.

**The registry is the endpoint records, not a second config.** A project = a live
`~/.spexcode/projects/<enc>/backend.json` written by that project's supervisor at bind time; the `<enc>`
dir name is the projectId. Only loopback `http` upstreams are honored — a record naming any other host is
ignored loudly and never proxied, so a crafted record cannot turn the hub into an open proxy. A projectId
arrives as one URL path segment and is validated explicitly (shape + registry membership) before any
lookup; unknown or hostile ids answer 404 before any upstream contact.

**Backends never see the gateway's credentials.** The hub's own cookies (`spex_*`) are stripped from every
proxied request and upgrade — a visitor's other cookies pass through untouched. Combined with
[[gateway-auth]]'s store, no password material ever crosses into a repo, a backend, or a backend log.

**Launch seam.** `startHubGateway({port, host, tls})` is the engine, TLS-capable via the same
resolved-cert posture as [[public-mode]]; the operator verb and the React admin/project UI on top of these
APIs are the successor lane — this node deliberately ships the contract and its enforcement first.
