---
scenarios:
  - name: scope-and-session-boundaries
    tags: [backend-api]
    code: spec-cli/src/gateway-auth.ts
    test:
      path: spec-cli/src/gateway-auth.test.ts
      name: full adversarial matrix (all tests in the file)
    description: >
      Exercise the authorization decision adversarially: verifier roundtrip and store hygiene (mode,
      plaintext), token tamper/forgery/expiry, gen rotation on set/clear, the implicit-loopback rule
      against real and spoof-shaped remote addresses, and the projectId claim check with tokens presented
      under wrong cookie names and cross-scope mailboxes. Then the same decision on the peer entry: the
      identical loopback call on both entries side by side, a peer credential offered as a cookie and offered
      on the console entry, granting twice and revoking one machine of two, and a machine claim replayed
      against another machine's route and another store's secret.
    expected: |
      Verifiers verify only the exact password and serialize with no plaintext; the store file is 0600 with
      a persistent random secret. A tampered, forged (other store's secret), expired, or future-dated token
      is null. Re-setting or clearing any password invalidates every token it minted. Admin routes: implicit
      allow ONLY from a loopback socket address while no admin verifier exists (headers never consulted),
      locked otherwise; once a verifier exists, only a valid admin token passes. Project routes: open with
      no verifier; a project token passes only when its projectId claim equals the routed project —
      relabeled cookie names, admin-mailbox swaps, and cross-project presentation all deny.

      The entry is the discriminator and only the listener sets it. On the peer entry a loopback socket that
      the console entry answers via:'loopback' is refused for 'peer-credential', no cookie is ever a channel
      for a peer credential, and only an issued token passes — carrying the machine id it was issued to and
      reaching a gated project the way admin does. On the console entry a peer credential is ignored
      entirely. Re-granting a machine keeps every token it already holds valid; revoking one machine ends
      only that machine's tokens and leaves the other's working. A machine claim is confined to the machine
      it names, and a token minted under another store's secret is null on both entries.
---

Measured by the adversarial unit matrix in `gateway-auth.test.ts` (the module is pure decision logic; its
product surface is [[gateway-hub]]'s HTTP face, measured by that node's scenario). Run
`npx tsx --test spec-cli/src/gateway-auth.test.ts` and file the transcript.
