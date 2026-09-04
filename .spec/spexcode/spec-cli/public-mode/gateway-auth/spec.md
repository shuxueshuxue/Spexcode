---
title: gateway-auth
hue: 150
desc: The one authorization mechanism of the multi-project gateway — two visitor scopes plus a peered machine's own door, verifiers in the per-user private store, backends never see a credential.
code:
  - spec-cli/src/gateway-auth.ts#authorize
  - spec-cli/src/gateway-auth.ts#verifyToken
  - spec-cli/src/gateway-auth.ts#makeVerifier
  - spec-cli/src/gateway-auth.ts#grantPeer
related:
  - spec-cli/src/gateway-hub.ts
  - spec-cli/src/gateway-auth.test.ts
  - packages/spec-core/src/layout.ts
---
# gateway-auth

**Authorization is a gateway concern, decided once, by one mechanism.** The project backends behind
[[gateway-hub]] stay loopback internal services that know nothing about passwords or visitors — no auth
code, no credential, no session state ever lives in a backend or its records. Everything about who may
cross the boundary is decided here.

**Exactly two VISITOR scopes.** An **admin** session grants `/projects`, project management, and every
`/p/:projectId` route; a **project** session grants exactly its own `/p/:projectId` route and nothing
else — not another project, never the admin surface. There is no third visitor scope and no per-route
special case: every request reduces to one `authorize` decision.

**The gate is opt-in at both levels, and the ungated defaults differ deliberately.** A project with no
configured password is **open** — same philosophy as [[public-mode]]'s single gate, the operator chooses.
The admin surface inverts: with no admin password, **loopback may manage implicitly** (the bootstrap path —
the first password is set from the machine itself) while **non-loopback `/projects` stays locked**, because
an unconfigured management plane must fail closed to the internet. The loopback decision reads only the
socket's remote address, never a header — `X-Forwarded-For` is attacker-controlled.

**A peered machine is not a visitor, so it gets its own scope and its own door.** The implicit-loopback
grant above reads the socket's remote address, and an SSH forward makes that address say the wrong thing:
a peered machine's gateway sees loopback and would otherwise grant management to whoever can reach its
neighbour. Nothing in the request can settle it — a header is attacker-controlled and the address is
genuinely identical — so the discriminator is WHICH LISTENER the request arrived on. The gateway binds a
second, always-loopback **peer-ingress** entry that `--host` never widens, a peer's forward targets that
entry and never the human's port, and the entry is an argument to the decision. On the console entry the
decision is exactly what it was. On the peer entry implicit loopback trust is never granted — a machine has
no console — and only a **peer** credential authorizes.

**A peer credential is issued, named, and revocable, which is what makes it not inherited.** It is minted
on THIS machine during the SSH-authenticated accept handshake, so the authority behind it is a shell here;
it names the machine id it was issued to; and the store keeps a generation per peer, so this machine can
revoke one peer's access without touching a password or any other peer — the same mechanism that already
makes a session die with the password that minted it. It travels as a header on the peer entry rather than
as a cookie, because it belongs to a machine relationship and not to a browser, and a visitor's own `spex_*`
cookies are stripped before a request leaves for another machine. Its reach is admin-equivalent on the
machine that issued it, and the honest consequence is stated rather than hidden: whoever holds admin scope
on a machine can act as admin on the machines it has peered, exactly as whoever holds a shell there can.

**Password verifiers live only in the gateway's private per-user store** (`~/.spexcode/gateway/auth.json`,
0600 in a 0700 dir) — never in a repo, a `.spec/spexcode.json`, or a backend record. A verifier is a salted
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
