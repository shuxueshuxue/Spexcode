---
scenarios:
  - name: self-launch-explicit-runtime-binding
    tags: [backend-api]
    description: A real protocol database receives an adopter-supplied native identity through the self-launch package API.
    expected: Bind, resolve, restart fencing, and unbind preserve the protocol address and its pending message without inferring identity.
    code: packages/session-selflaunch/src/index.ts
---
# self-launch bindings eval

Run `node scripts/selflaunch-bindings-yatu.mjs` from the repository root. The fixture supplies a native identity
explicitly and checks the shared runtime-binding generation fence. It is not a proof that a real harness can be
discovered automatically; that identity-discovery claim remains outside this adopter package.
