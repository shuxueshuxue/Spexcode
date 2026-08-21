# Self-launch runtime binding plan

The self-launch CLI is intentionally a one-shot protocol client. It has no resident harness process and no native
identity to discover. The cut-in therefore lives in the package API, not in an inferred CLI flag or a new protocol
column.

```ts
const protocol = openProtocol(databasePath)
protocol.initialize('logical-session')

const binding = bindSelfLaunchRuntime(protocol, 'logical-session', {
  nativeSessionId: harness.sessionId,
  nativeStartToken: harness.startToken,
  metadata: { source: 'hook-adapter' },
})
```

The caller owns `harness.sessionId` and `harness.startToken`. `session-selflaunch` fixes the namespace to
`self-launch`, calls the shared runtime-binding component inside the protocol transaction, and leaves launch, stop,
liveness, and message delivery to the caller's adapter. A logical session id alone is not sufficient evidence.

The proof is deliberately small: bind an explicit identity, resolve it, rebind with a new start token using the
generation fence, unbind, and verify that the protocol address and pending messages are unchanged. A self-launch path
that has no native harness identity is reported as unbound/NOT-MEASURED rather than being given a fabricated binding.
