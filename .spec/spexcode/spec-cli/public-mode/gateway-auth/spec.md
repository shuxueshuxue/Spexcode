---
title: gateway-auth
hue: 150
desc: The one authorization mechanism of the multi-project gateway — two signed scopes, verifiers in the per-user private store, backends never see a credential.
code:
  - spec-cli/src/gateway-auth.ts#authorize
  - spec-cli/src/gateway-auth.ts#verifyToken
  - spec-cli/src/gateway-auth.ts#makeVerifier
related:
  - spec-cli/src/gateway-hub.ts
  - spec-cli/src/gateway-auth.test.ts
  - spec-cli/src/layout.ts
---
# gateway-auth

**Authorization is a gateway concern, decided once, by one mechanism.** The project backends behind
[[gateway-hub]] stay loopback internal services that know nothing about passwords or visitors — no auth
code, no credential, no session state ever lives in a backend or its records. Everything about who may
cross the boundary is decided here.

**Exactly two signed scopes.** An **admin** session grants `/projects`, project management, and every
`/p/:projectId` route; a **project** session grants exactly its own `/p/:projectId` route and nothing
else — not another project, never the admin surface. There is no third scope and no per-route special
case: every request reduces to one `authorize(store, route, cookies, remoteAddr, port)` decision.

**The gate is opt-in at both levels, and the ungated defaults differ deliberately.** A project with no
configured password is **open** — same philosophy as [[public-mode]]'s single gate, the operator chooses.
The admin surface inverts: with no admin password, **loopback may manage implicitly** (the bootstrap path —
the first password is set from the machine itself) while **non-loopback `/projects` stays locked**, because
an unconfigured management plane must fail closed to the internet. The loopback decision reads only the
socket's remote address, never a header — `X-Forwarded-For` is attacker-controlled.

**Password verifiers live only in the gateway's private per-user store** (`~/.spexcode/gateway/auth.json`,
0600 in a 0700 dir) — never in a repo, a `spexcode.json`, or a backend record. A verifier is a salted
scrypt hash compared in constant time; plaintext never touches disk. The same store holds a random signing
secret, so sessions are stateless HMAC-signed cookies that survive a gateway restart.

**A session dies with the password that minted it.** Each verifier carries a random `gen`, rotated on
every set/clear; tokens embed the gen they were minted under and verify only against the current one — so
changing or clearing a password instantly invalidates every session it authenticated, with no session
table to sweep.

**The token's claim is the authority, never the cookie's envelope.** Cookies are `httpOnly`, minted by the
designed login ([[public-mode]]'s page, not Basic Auth), and named per port + projectId hash — but names
and `Path` attributes are client-controlled, so authorization always re-validates the token's own
projectId claim against the `:projectId` in the requested route. Relabeling, re-pathing, tampering, or
presenting a token signed under another user's store all authorize nothing.
