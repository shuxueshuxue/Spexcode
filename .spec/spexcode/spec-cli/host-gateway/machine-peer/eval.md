---
scenarios:
  - name: peer-send-reaches-normal-input-and-preserves-return-identity
    description: >
      Start the host peer service with an established loopback peer forward, then use the real CLI
      `peer ls` and `session send --ssh` faces. Also exercise the remote peer ingress against one,
      zero, and multiple local project ownership matches.
    expected: >
      The CLI sends through the peer forward only when that named tunnel exists; the remote gateway
      derives exactly one project and forwards a normal text input with the stable peer machine/session
      identity. Missing or ambiguous session ownership fails loudly, and removing session state never
      tears down the machine peer.
    tags: [cli, backend-api]
    test:
      path: spec-cli/src/machine-peer.test.ts
      name: the peer and session CLI surfaces use the gateway-owned peer forward
    code: spec-cli/src/machine-peer.ts
---

The local regression uses a disposable SPEXCODE_HOME and a pair-shaped loopback forward so it can prove the
CLI and ordinary backend-input boundary without an operator's SSH credentials. Deployment YATU uses two real
machines: create one `spex peer connect <ssh-address>`, send from one session to a full id on the other,
reply using the injected `--ssh` command, close the target session, then send to a later session through the
same peer.
