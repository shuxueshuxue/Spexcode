---
title: machine-peer
status: active
hue: 180
desc: A gateway-owned, SSH-backed bidirectional tunnel between two machines, reusable by every project session.
code:
  - spec-cli/src/machine-peer.ts
related:
  - spec-cli/src/host.ts
  - spec-cli/src/client.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/gateway-auth.ts
  - spec-cli/src/gateway-hub.ts
  - spec-cli/src/machine-peer.test.ts
---
# machine-peer

## raw source

An agent that has sent a message across machines must be able to receive the answer without another human
pairing. Build that capability on the existing host gateways and SSH: the gateways own one bidirectional
communication tunnel between their machines, and sessions use it without becoming its owner.

## expanded spec

**A peer is a machine pair.** Its durable state belongs in the per-user private gateway store, never in a project
config, a backend endpoint record, or a session record. Session close, a backend restart, and adding or removing
projects do not terminate it. Explicit disconnect, SSH failure, or revoked credentials do. The gateway's claim on its
control socket is proven by a connect, never by the file: a killed gateway leaves `peer.sock` behind, so a path that
refuses a connection is reclaimed at start, and only an accepting listener means another `spex dashboard` owns the
machine. The gateway owns the SSH child and both loopback-only forwarded ports, so a one-shot `session send` never
leaves an orphaned background process. A later session on either machine reuses the peer; a reconnect restores the
same peer rather than performing a new human pairing.

**One SSH connection has two directions.** Initial connection uses an opaque SSH address exactly as supplied by
the agent, together with the ordinary ssh options supplied beside it. Reachability is the agent's to state and
never the tool's to guess: an address that resolves only under a custom ssh config, identity, port, or jump host
states those options once at connect, and the peer records them and replays them verbatim on every later dial —
the tunnel, the accept handshake, and the remote cleanup — so no later cross-machine command repeats them and
disconnect accepts none. They are ssh's grammar rather than SpexCode's own flag space, and they are a
reachability hint exactly like the address: never an identity and never an authorization proof. A peer minted
before options existed carries none, which is a legacy record to normalize rather than a malformed store. The dial
establishes one forward toward the far gateway and one reverse forward publishing this machine's own gateway over
there, so each side reaches the other through that single SSH child. The receiver never opens a second SSH
connection of its own and never requires credentials for the initiator. The peer has a stable randomly-minted machine id for semantic naming; an SSH address is only a
mutable reachability hint. A hostname, gateway URL, and backend `instanceId` are neither an identity nor an
authorization proof.

**The peer forwards the far gateway, and offers this one back.** An owned peer carries a
gateway leg — a local loopback port, the far gateway's published **peer-ingress** port, the instance id that port
was published under, and the credential that gateway issued to this machine — so the machine on the other end is
addressable here as an ordinary loopback upstream. The leg targets that ingress and never the console port: a
forward into the console would arrive as a loopback socket and inherit the trust [[gateway-auth]] grants a human
sitting at that machine, so a gateway publishing no ingress is answered as no gateway at all. Those far facts come
from that machine's own host record, read when it answers the dial and never inferred from a default: with no
record published, no ingress in it, or no credential issued, the leg is simply absent, because a
recorded-but-wrong port is a lie no later reader could detect. The credential is minted by the answering machine
for the asking one during the accept handshake — the SSH login that carried the request IS the authentication
behind it — and it is named by machine id and revocable per machine, so re-connecting refreshes it without
invalidating what the caller already holds and disconnecting destroys every credential that machine was handed. Only the connecting side runs an SSH child, so a
leg is the one thing the accepting side cannot build for itself; the reverse forward of that same dial is how it
gets one. The accepting side names the local port its leg should arrive on, and the dialler mints a credential for
it and hands it over — which is why the accept handshake runs twice and is idempotent: a credential only means
something to the machine that issues it, so the first call is what tells the dialler whom it is minting for. A
dialler publishing no ingress of its own offers nothing back, and a refused handover is logged rather than fatal,
because the outward leg is already usable without it. And because the reconnect loop redials without asking the far side anything, re-running
connect is the explicit refresh: it adopts a restarted far gateway, keeps the local port stable across that
rebuild so existing addressing survives it, and leaves a recorded leg untouched when the far side cannot be
reached at all. A superseded dial reports nothing, because the child that replaced it already owns the peer's
state and an old child's exit must not mark a live tunnel broken. What may be routed INTO that port is
[[machine-routing]]'s contract rather than this node's. The leg is reachable only from this machine, and the
credential beside it is stated plainly rather than hidden: on the issuing machine it reaches what an admin
reaches, which is why it is issued per machine and destroyed with the link.

**The remote command resolves in the remote's own environment.** The accept handshake and the remote cleanup run
`spex` on the far machine, and where a program lives is that machine's own configuration rather than something this
side may assume from its own: the dial resolves them through the remote user's login shell, never the bare
non-interactive PATH an SSH command string is handed. A login shell may greet before it runs anything, so the peer
reply is read off the last line of the reply stream rather than the whole stream. When no reply arrives at all the
failure is named and states that `spex` must be on that SSH user's login PATH, instead of passing the remote shell's
raw not-found text back as malformed JSON.

**The gateway is the whole door; there is no second one.** A cross-machine call is an ordinary [[gateway-hub]]
request over the peer leg, carrying the credential that gateway issued this machine. There is no per-peer listener,
no route allowlist, and no second request parser. The hub already carries HTTP, SSE, WebSocket upgrades, and live
terminals, so a hand-written door beside it could only ever be the smaller, staler half of the same thing — and was.
What a peer credential admits is [[gateway-auth]]'s and [[machine-routing]]'s contract rather than this node's.

Two things that door owned had to move rather than vanish with it. **Addressing by session** is one: the hub speaks
projects and an agent holds a session UUID, so the hub answers a session-addressed path as the same project route,
deriving the project from this machine's own per-project session stores exactly as before — no match is a named
not-found, more than one is a loud ambiguity, and the endpoint is chosen by the record's `worktree_path`, with the
unique endpoint sharing its common-dir store as the retired-session fallback and several candidates a loud
ambiguity. That derivation is offered at every entry rather than only the peer one, because a derivation that is
correct is correct for whoever asks. **The sender stamp** is the other: on the two routes that carry a sender claim
— text input's `from` and close's `source` — a request authorized as a peer has its claim rewritten to the
authenticated machine identity, spelled `peer_<machineId>_<sessionId>` (or `peer_<machineId>` when the sender named
no session) because that identity travels as the message's ordinary `senderSessionId` and must therefore fit
[[session-protocol]]'s frozen `session_id` grammar, which admits neither `:` nor a leading `-`; close becomes an
ordinary user close. The stamp is applied where the request is authorized, so it now covers every project route a
peer can reach instead of five hand-listed ones. That is a widening, and honestly so: those five were already
bypassable through the machine route, where a peer could reach the same backend under any sender claim it liked.

What that door's closed create body was NOT is a boundary — for the same reason. It rejected `parent` and every
project and filesystem field, but a peer could always post whatever body it wanted through the machine route, so
that clause described the CLI verb's shape rather than the door's. It still does: `spex session new --ssh` sends
`{prompt, launcher?, name?, base?}` under an ordinary `Idempotency-Key` header, so a remote new stays parentless,
admission-controlled by the remote backend, and idempotent across the tunnel, and never falls back to launching on
the initiating machine. The backend still never parses SSH addresses, holds peer state, or gains a cross-machine
code path.

A peer record written before this single door names forwarded ports for a listener no gateway runs any more.
Carrying one would be a link that quietly forwards into nothing, so such records are dropped at read, once, with a
named relink command, rather than migrated into a shape they were never measured in. A peer link only lives while
its SSH child does, so the whole recovery is one `spex peer connect` per machine.

**Acceptance preserves the existing definition.** A cross-machine send reports `sent` only when the remote
backend accepted the normal timeline append. Establishing SSH, reaching a peer port, or obtaining an HTTP
connection does not itself count. A missing peer produces a named `no communication tunnel` error that includes
the supplied opaque SSH address and repair command. The CLI neither opens SSH nor retries automatically: the
agent decides to run `spex peer connect <address>` and reissue its original send.

**The CLI carries no dashboard-URL protocol.** A shared dashboard session URL is context for the agent, which
may use its own information to find an SSH address and full session UUID. SpexCode does not parse, store, or
route that URL. Its machine-facing surface is `spex peer connect [ssh-option...] <address>`, `spex peer ls|disconnect` and
`spex session show --ssh <address> <full-session-id>`, `spex session send --ssh <address>
<full-session-id> <text>`, `spex session close --ssh <address> <full-session-id>`,
`spex session ls --ssh <address> <full-session-id>`, and `spex session new --ssh <address>
<full-session-id> <prompt>`. With `--ssh`, the first positional is always a full id; for `ls` and `new` it is
the project anchor, so remote `ls` accepts exactly that one positional and never pretends it filters the result.
Remote creation appends the ordinary peer reply hint to its prompt, but installs neither a cross-machine parent
nor a watch. Incoming text envelopes carry the sender's stable machine id, full session id, display label, and
the opaque peer address needed for a runnable reply insert.
Those values make a reply semantically addressable and unique; what authorizes delivery is the credential the
receiving gateway issued over the SSH-created leg, and nothing else.
