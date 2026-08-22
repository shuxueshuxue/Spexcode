# Spex governed runtime binding cut-in

## What is real today

`spec-cli/src/sessions.ts` already commits one exact native harness id to a governed session record. Codex registration
also fences that id with an exact runtime generation. Those are real adopter facts; they do not belong in the protocol
session row.

The shared runtime-binding component needs four inputs before the record write can be joined to it:

1. an existing globally unique protocol session id;
2. an explicitly resolved absolute protocol database path;
3. a positive storage-locality verdict obtained before opening that database; and
4. a native start token that changes when the attached runtime instance changes.

The governed path currently has the first input only as a legacy record id, has the native harness id, and has a start
token only for Codex (`generationId`). It has no production protocol database handle and no locality resolver result.
`runtimeRoot()` is a directory authority for the existing Spex store, not permission to invent
`runtimeRoot()/sessions.sqlite`.

## Exact adapter seam

```ts
const binding = bindSpexGovernedRuntime(protocol, bindings, {
  protocolSessionId: governed.id,
  harnessId: governed.harness,
  harnessSessionId: receipt.harnessSessionId,
  nativeStartToken: receipt.generationId,
  metadata: { launcher: governed.launcher },
})
```

The adapter fixes `namespace: "spex-governed"`, runs `bindings.bind` inside `protocol.withTransaction`, and forwards an
optional expected generation. It does not launch a harness, inspect liveness, initialize a protocol address, or write
the legacy record.

## Production blocker and next cut

The smallest honest production cut is owned by the Spex application composition, not this leaf adapter:

1. resolve configured storage and prove locality;
2. open protocol, topology, runtime bindings, and application service from the same database;
3. initialize/import the governed address before native registration;
4. stage an exact native start token for every harness kind;
5. bind runtime identity and publish the governed record under one adopter-owned crash contract.

Until that composition exists, `bindHarnessSessionIdUnlocked` remains on the legacy authority. This lane deliberately
does not add a default path, an optional best-effort binding, or a hidden fallback. Those shapes would make a passing
registration unable to say which database owns the binding.
