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
the agent. It establishes one local-to-remote forward and one remote-to-local forward. The receiver replies on
the reverse forward of that same connection; it never opens a second SSH connection or requires credentials for
the initiator. The peer has a stable randomly-minted machine id for semantic naming; an SSH address is only a
mutable reachability hint. A hostname, gateway URL, and backend `instanceId` are neither an identity nor an
authorization proof.

**The gateway is the transport endpoint; the backend remains ordinary.** A dedicated loopback listener accepts five
full-id peer requests: `GET /api/sessions/:id` (show), `POST /api/sessions/:id/input` (text send), `POST
/api/sessions/:id/close` (close), `GET /api/sessions/:id/project/sessions` (the selected project's default session
projection), and `POST /api/sessions/:id/project/sessions` (create in that selected project). The full UUID is the
project anchor for the last two routes, not a list selector or a parent. The listener is a short allowlist, never a
generic proxy: query strings remain rejected, so a peer list has only the ordinary default projection rather than a
hidden route to archives. Its reachability is authorized by the authenticated SSH connection which created the
listener; it does not add a third [[gateway-auth]] scope or expose a public route. The receiver derives the target
project by scanning its own per-project session stores for the full UUID: no match is a named not-found failure and
more than one match is a loud ambiguity. Session records are grouped by Git common directory, while backend endpoint
records are keyed by the worktree they serve, so after finding one session record the gateway selects the endpoint
whose published root equals that record's `worktree_path`. A direct endpoint in the session slot remains valid; a
unique endpoint sharing the same common-dir store is the retired-session fallback, while several candidates are a loud
ambiguity. It invokes that project's normal local detail, text-input, close, list, or create path; input rewrites an
untrusted sender claim to the authenticated peer identity — spelled `peer_<machineId>_<sessionId>` (or
`peer_<machineId>` when the sender named no session), because that identity travels as the message's ordinary
`senderSessionId` and must therefore fit [[session-protocol]]'s frozen `session_id` grammar, which admits neither `:`
nor a leading `-` and expects namespaces to be encoded into the id — and close is an ordinary user close. Peer create
takes only `{prompt, launcher?, name?, base?, requestKey}`: the gateway turns `requestKey` into the normal internal
`Idempotency-Key`, rejects `parent` and every project/filesystem field, and forwards no caller headers. A remote new
is therefore parentless, admission-controlled by the remote backend, and idempotent across the tunnel; it never falls
back to launching on the initiating machine. The backend never parses SSH addresses, holds peer state, or gains a
cross-machine code path.

**Acceptance preserves the existing definition.** A cross-machine send reports `sent` only when the remote
backend accepted the normal timeline append. Establishing SSH, reaching a peer port, or obtaining an HTTP
connection does not itself count. A missing peer produces a named `no communication tunnel` error that includes
the supplied opaque SSH address and repair command. The CLI neither opens SSH nor retries automatically: the
agent decides to run `spex peer connect <address>` and reissue its original send.

**The CLI carries no dashboard-URL protocol.** A shared dashboard session URL is context for the agent, which
may use its own information to find an SSH address and full session UUID. SpexCode does not parse, store, or
route that URL. Its machine-facing surface is `spex peer connect|ls|disconnect` and
`spex session show --ssh <address> <full-session-id>`, `spex session send --ssh <address>
<full-session-id> <text>`, `spex session close --ssh <address> <full-session-id>`,
`spex session ls --ssh <address> <full-session-id>`, and `spex session new --ssh <address>
<full-session-id> <prompt>`. With `--ssh`, the first positional is always a full id; for `ls` and `new` it is
the project anchor, so remote `ls` accepts exactly that one positional and never pretends it filters the result.
Remote creation appends the ordinary peer reply hint to its prompt, but installs neither a cross-machine parent
nor a watch. Incoming text envelopes carry the sender's stable machine id, full session id, display label, and
the opaque peer address needed for a runnable reply insert.
Those values make a reply semantically addressable and unique, but only the SSH-created loopback listener
authorizes delivery.
