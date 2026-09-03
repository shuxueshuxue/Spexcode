---
title: machine-routing
status: pending
hue: 178
desc: One origin addresses projects on every peered machine — the hub grows a machine segment, so a browser and the desktop switch machines through the same route grammar.
related:
  - spec-cli/src/gateway-hub.ts
  - spec-cli/src/machine-peer.ts
  - spec-cli/src/gateway-auth.ts
  - spec-cli/src/host-record.ts
  - spec-cli/src/client.ts
  - spec-cli/src/cli.ts
  - spec-dashboard/src/ProjectsPage.jsx
  - spec-dashboard/src/projects.js
  - spec-desktop/gateway-discovery.js
  - spec-desktop/main.js
---
# machine-routing

## raw source

Make it multi-gateway, categorized by machine, so a user can quickly switch between projects on
different machines. Keep the desktop and the web paths unified — unify whatever can be unified, and
refactor without hesitation wherever refactoring is what unification takes.

## expanded spec

### The machine dimension belongs to the hub, not to the shell

A remote machine can be reached two ways, and only one of them unifies. Pointing the desktop window at
a remote origin makes the machine a property of the WINDOW: the shell would grow a gateway list, the
single-instance lock would have to arbitrate between origins, `sameOrigin` navigation would stop being a
single decision, and a browser user would get none of it — which
[[spec-desktop]]'s own rule forbids, because anything the desktop can do `spex dashboard` plus a browser
must also be able to do. Putting the machine in the hub's ROUTE GRAMMAR instead makes it a property of
the ADDRESS: one origin, one SPA, one auth boundary, one set of deep links. The desktop shell then needs
no notion of machines at all — it keeps attaching to exactly one local gateway — and the browser gets
machine switching for free because it is the same surface. **Unification here is not making the two
clients match; it is refusing to put the feature in a layer only one of them has.**

So [[gateway-hub]] stays the multi-project face of ONE machine and becomes the multi-machine face of the
fleet by addressing, not by aggregation: `/m/:machineId/p/:projectId/*` routes into a peered machine's
gateway, and bare `/p/:projectId/*` permanently means *this* machine. The bare form is not legacy to be
migrated — it is the honest default (the machine you are talking to) and it keeps every existing link,
cookie scope, deep link and bookmark working unchanged.

### A peered machine is an admissible upstream by construction

Two hard-won invariants already say loopback and nothing else: the hub honors only a loopback `http`
upstream and shouts about any other host, and the desktop shell accepts only a loopback `http` origin. An
SSH forward lands on loopback. **Both checks are therefore satisfied without being relaxed** — a remote
gateway reached through [[machine-peer]]'s tunnel is indistinguishable, to every existing guard, from a
local backend, and no guard learns a special case for "remote".

[[machine-peer]] already owns the difficult parts — the SSH child, the durable per-user record, ssh
options recorded once and replayed verbatim on every dial — and gains one more forwarded leg to the
remote machine's gateway port. That port is not guessed: the remote machine publishes it in its own host
record ([[host-facts]]), read over the same authenticated remote command the peer already uses, and
instance-validated on every dial exactly as local discovery does, so a stale record degrades to "no
gateway" and never to a wrong one. A machine whose gateway is not running is a peer whose GATEWAY LEG is
unavailable, not a failed peer: the agent channel keeps working and the fleet view says that machine has
no gateway.

The forward targets the remote GATEWAY, never the peer listener. The listener is a five-route allowlist
for agent-to-agent session control and is deliberately not a proxy; the gateway is the surface that
already reverse-proxies a whole project — WebSocket upgrades and SSE included — so one forward yields the
complete product on that machine, live terminals and all.

That last sentence is measured rather than argued. Through a real `ssh -L` onto a throwaway hub, with no
product code changed, a browser loaded the project SPA and its bundles, `GET /api/graph` returned the same
599KB it returns locally, `/api/graph/stream` delivered SSE events, the terminal socket answered `101` and
carried the backend's own `TERM_PING_MS` heartbeat as a frame, and the warm cost of the whole forward was
single-digit milliseconds. One detail makes the deeper prefix free as well: the built `index.html`
references its assets RELATIVELY, so it resolves them correctly under any prefix depth and a machine
segment needs no build change, no `<base>`, and no absolute asset root.

### The forwarded gateway port is where a peer is addressable here

A peer is reachable through its own gateway, so the peer record carries a gateway leg: a local loopback port,
the far gateway's own port, and the instance id that port was published under. Those far facts are PUBLISHED,
never guessed — the accepting machine reads its own host record when it answers a dial, so the answer is either
the gateway it runs right now or an honest absence, and an absence records no leg at all rather than a port
nobody could later prove wrong. A leg is therefore always either correct-as-of-its-instance or missing.

The leg is directional, and the record says so instead of pretending otherwise. `spex peer connect` opens the
forward, so it makes the TARGET addressable HERE; the accepting side runs no ssh child of its own and so holds
no leg back, which is why its own gateway fields stay empty and the reverse view is one `peer connect` run on
that machine. Nothing here is symmetric that the transport is not.

Staleness has one repair, and it is explicit. The retry loop redials ssh without asking the far side anything,
so a gateway that restarted on another port would otherwise keep a forward aimed at a dead instance forever.
Re-running `peer connect` is that repair: it re-asks which gateway the far side publishes now and rebuilds the
leg when the instance changed, keeping the LOCAL port stable across the rebuild so whatever already addresses
it keeps working. A refused ask leaves the recorded leg untouched rather than erasing it, so an unreachable
peer can still have its tunnel kicked exactly as before.

The leg now carries a credential and still carries no route. What remains absent is anything that proxies INTO
the local end, so the port stays reachable only from this machine, by someone who already has a shell here —
which is what makes the route clause safe to land last and unsafe to land first.

### Authorization is explicit per machine, never inherited from loopback

The chain is visitor → this gateway → forwarded loopback port → the remote gateway. The remote gateway
sees loopback, and its implicit-loopback admin grant would then read "whoever can reach MY neighbour is
an admin HERE". That is authorization laundering and this contract forbids it. It is not a hypothesis:
through a forward, a hub with no admin password answers its admin surface with `adminGated:false` and
renders the sentence "management works from this machine only" to a reader who is not on that machine.
Today that costs nothing, because opening the forward requires SSH to the host and such an operator
already has a shell there — the grant is a PREMISE, not yet a hole. It becomes a hole on the day this
gateway proxies `/m/:machineId/*` into that port, since the visitor on this side holds no credential on
that side. Hence the ordering, and hence that the claim must stop being keyed on the peer address: a
forwarded socket forges it, and no listener can tell that it has been forwarded. A peer connection carries
its own machine-scoped credential, established at connect time over the authenticated SSH channel and
stored beside the ssh options it is replayed with; the local gateway's own `spex_*` cookies stay stripped
on the way out, as they already are for a local backend. **Implicit loopback trust authorizes a human at
a console, never a peer** — the remote gateway must be able to tell those apart, and a visitor's scope on
one machine grants nothing on another.

Telling them apart cannot rest on anything IN the request. A header is the caller's to write, and a
forwarded socket's remote address is not merely hard to distinguish from a console socket's — it is the
same loopback address. So the discriminator is the LISTENER: each gateway binds a second, always-loopback
peer ingress that no `--host` widens, publishes its port in its own host record, and decides every request
arriving there as a peer rather than a console. Implicit loopback trust is not granted on that door, a
visitor cookie arriving there settles nothing, and it carries no login page to redirect a machine to. The
credential is what does open it: issued by the answering gateway to the asking machine during the accept
handshake, named by that machine id, refreshed without invalidating what the caller already holds, and
destroyed for that machine alone when the link is dropped. Its reach is stated rather than hidden — on the
issuing machine it reaches what an admin reaches — which is exactly why it is per machine and revocable.
A gateway publishing no ingress is recorded as no leg at all, because a forward into the console port would
launder the trust this clause outlaws.

### What each machine answers for itself

A machine's project list comes from that machine's own hub, read live, and is presented as that machine's
group. This gateway caches nothing it cannot attribute: an unreachable machine renders as OFFLINE with no
rows at all, never with remembered rows shown as current. `encodeProject` is a path encoding, so two
machines with the same project path produce the same project id — ids stay machine-local by design and
the machine segment is what disambiguates them. No global id scheme is introduced, and no row is ever
shown without the machine it belongs to.

A remote route crosses two proxy hops instead of one, so both must share one lifecycle: an abrupt visitor
close tears down this gateway's exchange, the remote gateway's exchange, and the backend's, in that order.
A closed browser tab that leaves a live terminal child alive on another machine is the failure this
clause exists to prevent, and it is measured, not assumed. The lower half already measures clean: with an
SSE stream and a terminal socket both open across the forward, a client kill with no close handshake
returned the established-socket count to baseline at the forward, at the remote hub AND inside the backend
within seconds, so neither the sshd forward nor the hub's raw proxy leaks the FIN. The hop this node adds
is the one still to be proven the same way.

### The consequences that follow

Deep links gain the same segment: `spexcode://m/<machineId>/p/<projectId>/…`, with the bare form meaning
this machine, resolved by the shell against its one local gateway — which is why the shell still needs no
machine list. And once machine-qualified routing and explicit peer credentials both exist, the five
hand-written `--ssh` verbs are addressing a subset of a route that now carries everything: `--ssh` becomes
spelling sugar over a machine-qualified route, and the allowlist listener with its five-route parser and
its own forwarding path can go. That collapse is sequenced strictly AFTER the credential work, because
doing it first would trade a deliberate allowlist for the inherited loopback trust this node just
outlawed. One guarantee must survive it: a remote caller may never claim to be a local session, so the
sender rewrite that stamps a peer's input with its machine and session identity moves to wherever the
remote route is authorized rather than disappearing with its current host.

This node governs no source file. It is the routing contract the hub, the peer, and the auth store each
implement in their own body, so a change to any of them is that node's drift and never a phantom warning
here.
