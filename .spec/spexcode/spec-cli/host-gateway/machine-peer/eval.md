---
scenarios:
  - name: dashboard-recovers-stale-peer-socket-without-stealing-live-one
    description: >
      Start a gateway with an orphaned peer control pathname, then start a second gateway while the first
      one is live.
    expected: >
      The orphaned pathname is replaced and the new gateway answers the control RPC. A responsive socket
      still rejects the second gateway with the named already-running diagnostic, and the failed second
      startup does not remove the first gateway's socket.
    tags: [cli]
    test:
      path: spec-cli/src/machine-peer.test.ts
      name: a stale peer socket is removed before the gateway binds
    code: spec-cli/src/machine-peer.ts
  - name: peer-send-reaches-normal-input-and-preserves-return-identity
    description: >
      Start the host peer service with an established loopback peer forward, then use the real CLI
      `peer ls` and `session show|send|close|ls|new --ssh` faces. Also exercise the remote peer ingress against
      one, zero, and multiple local project ownership matches.
    expected: >
      The CLI sends through the peer forward only when that named tunnel exists; the remote gateway
      derives exactly one project and forwards only normal session detail, text-input, close, default-board,
      and parentless-create requests. Text input has the stable peer machine/session identity; close is
      normalized to an ordinary user close; create uses a closed requestKey envelope and does not locally
      fall back. Any unlisted operation or query-string archive escape is rejected. Missing or ambiguous
      session ownership fails loudly, and removing session state never tears down the machine peer.
    tags: [cli, backend-api]
    test:
      path: spec-cli/src/machine-peer.test.ts
      name: the peer and session CLI surfaces use the gateway-owned peer forward
    code: spec-cli/src/machine-peer.ts
  - name: linked-worktree-peer-return
    description: >
      Address a session stored under a Git common-dir runtime from a peer, where its active backend
      was published by the linked worktree that owns the session record's worktree_path.
    expected: >
      The peer gateway routes the normal input to that worktree's published backend, and a reply
      returns through the existing bidirectional tunnel without a second peer connection.
    tags: [cli, backend-api]
    test:
      path: spec-cli/src/machine-peer.test.ts
      name: a common-dir session routes to the endpoint published for its linked worktree
    code: spec-cli/src/machine-peer.ts
---

The local regression uses a disposable SPEXCODE_HOME and a pair-shaped loopback forward so it can prove the
CLI and ordinary backend-input boundary without an operator's SSH credentials. Deployment YATU uses two real
machines: create one `spex peer connect <ssh-address>`, send from one session to a full id on the other,
reply using the injected `--ssh` command, close the target session, then send to a later session through the
same peer.
