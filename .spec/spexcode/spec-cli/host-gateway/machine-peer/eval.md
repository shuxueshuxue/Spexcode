---
scenarios:
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
  - name: stale-control-socket-is-reclaimed
    description: >
      Kill a running host gateway without letting it shut down (its peer.sock stays behind), then start
      `spex dashboard` again on the same machine and connect a peer to it.
    expected: >
      The new gateway starts and owns the control socket: a leftover path that refuses a connection is
      unlinked and reclaimed, and a peer connect then succeeds through it. Only a path that accepts a
      connection is another live gateway, and that case still refuses loudly.
    tags: [cli]
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
  - name: ssh-options-recorded-and-replayed
    description: >
      Through the real CLI, connect a peer whose address resolves ONLY under a custom ssh config, then
      confirm the options were kept on the peer rather than on the one call: read them back with `peer ls`,
      and reach a session on the far machine with `session send --ssh` without naming them again. Include a
      peer record minted before options existed, and a `peer disconnect` that tries to supply them.
    expected: >
      The connect succeeds where a bare dial cannot resolve the address at all, and every later dial replays
      the recorded options - the tunnel, the accept handshake, and the remote cleanup - so no cross-machine
      command repeats them and disconnect refuses them loudly. A legacy peer carrying no options renders and
      dials as an empty list instead of failing the read. Options keep ssh's own grammar and order, and
      spex's `--flag` space stays separate.
    tags: [cli]
    test:
      path: spec-cli/src/machine-peer.test.ts
      name: ordinary ssh options are parsed in ssh grammar, recorded on the peer, and replayed on every dial
    code: spec-cli/src/machine-peer.ts
  - name: remote-command-resolves-in-login-shell
    description: >
      From two real machines, run `spex peer connect` toward a remote whose spex is installed where only that
      user's login profile puts it, so the bare PATH an ssh command string is handed does not carry it. Dial in
      both directions and read the outcome off the CLI.
    expected: >
      The connect succeeds in both directions: the remote accept handshake resolves through the remote user's
      own login shell rather than the PATH the tool happens to have, so a peer path is never one-directional
      because of where the far machine installed its tools. A login shell greeting ahead of the reply does not
      corrupt the handshake, and a remote that genuinely cannot run spex fails with a named error stating that
      spex must be on that ssh user's login PATH - never a raw shell not-found surfaced as malformed JSON.
    tags: [cli]
    code: spec-cli/src/machine-peer.ts
---

The local regression uses a disposable SPEXCODE_HOME and a pair-shaped loopback forward so it can prove the
CLI and ordinary backend-input boundary without an operator's SSH credentials. Deployment YATU uses two real
machines: create one `spex peer connect <ssh-address>`, send from one session to a full id on the other,
reply using the injected `--ssh` command, close the target session, then send to a later session through the
same peer.
