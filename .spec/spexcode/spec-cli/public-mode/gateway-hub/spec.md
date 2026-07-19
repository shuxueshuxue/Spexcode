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
  admin UI drives. Admin scope required; with no admin password, loopback only. `GET /projects` is
  content-negotiated: when a host `fallback` is mounted and the request explicitly accepts `text/html`
  (browser navigation — the `/` redirect lands here), it serves the SPA shell instead of the catalog —
  the shell is code, not data (the fallback's own posture), and every data call it makes re-enters the
  gated JSON route. All API fetches (`application/json`, `*/*`) keep the catalog envelope and its auth
  semantics, as does the bare hub with no fallback.
- `/p/:projectId/*` — the project surface: `login`/`logout` are the hub's own (the designed login page,
  parameterized), everything else is reverse-proxied to that project's backend with the `/p/:projectId`
  prefix stripped, WebSocket upgrades included. Admin or matching-project scope, or open when ungated.
  Browser navigation is content-negotiated the same way as `GET /projects` and, like the fallback it
  rides, pre-authorization — the shell is code, not data, and a direct guest must reach the in-app
  credential card ([[projects-hub]]), not a dead-end redirect: an explicit text/html GET outside `/api`
  serves the SPA shell; api/SSE/health fetches and the WS upgrade keep the auth gate and the backend.
- `/login`, `/logout` — the admin session, same designed page.

**The registry is the endpoint records, not a second config.** A project = a live
`~/.spexcode/projects/<enc>/backend.json` written by that project's supervisor at bind time; the `<enc>`
dir name is the projectId. The hub reads records through the ONE record seam ([[host-gateway]]'s
identity-carrying shape): a legacy or torn record is not routable, and a record sitting in a slot its own
root does not encode to is not trusted. Only loopback `http` upstreams are honored — a record naming any
other host is ignored loudly and never proxied, so a crafted record cannot turn the hub into an open
proxy. A projectId arrives as one URL path segment and is validated explicitly (shape + registry
membership) before any lookup; unknown or hostile ids answer 404 before any upstream contact.

**Backends never see the gateway's credentials.** The hub's own cookies (`spex_*`) are stripped from every
proxied request and upgrade — a visitor's other cookies pass through untouched. Combined with
[[gateway-auth]]'s store, no password material ever crosses into a repo, a backend, or a backend log.

**Launch seam.** `startHubGateway({port, host, tls})` is the engine, TLS-capable via the same
resolved-cert posture as [[public-mode]]. The operator verb is `spex dashboard` ([[host-gateway]]), which
mounts the host registry/catalog/operations onto the hub's **extension seam** — three optional hooks, all
inert when absent: `listProjects` enriches the `GET /projects` rows (the hub keeps the envelope and the
admin gate), `adminRoute` handles extra `/projects/*` routes only AFTER admin authorization, and
`fallback` serves the dashboard shell for paths the hub doesn't own. The React admin/project UI on top of
these APIs is the successor lane.
