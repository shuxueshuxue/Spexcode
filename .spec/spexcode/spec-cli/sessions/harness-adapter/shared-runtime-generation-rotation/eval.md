---
scenarios:
  - name: legacy-root-drains-while-current-routes-new
    test: spec-cli/src/codex-runtime-generation.yatu.test.ts
    description: >
      Start an isolated real Codex app-server/backend with a legacy root containing 22 loaded references:
      13 governed, 9 unowned protective, five active, plus native peers. Create the detached-v3 current
      generation through the normal session launch surface. Verify a new governed thread is bound to the
      new generation, legacy unowned references remain loaded, a target-only archive becomes offline, and
      close removes only the exact merged target while active protected sessions remain online.
    expected: >
      New governed traffic is bound to the new current generation. The legacy root remains draining and its
      unowned/native references remain loaded. Archive and close affect only the exact governed target and
      leave every protected legacy reference and active governed sibling intact.
    tags: [backend-api, cli]
  - name: host-restart-heals-dead-root
    test: spec-cli/src/codex-runtime-generations.test.ts
    description: >
      Take a project whose governed Codex sessions are bound to a running app-server root, then remove that root
      the way a host restart does — its process gone and its socket with it — while the ledger still names it.
      Resume a bound session through the real launch surface and start a new one.
    expected: >
      Resume brings the session's own thread back on a root a client can actually connect to: the dead root is
      retired, a replacement is started, and the binding is re-pinned to it with its thread unchanged. A new
      launch routes to that same replacement instead of refusing. No client is ever handed a socket that cannot
      be connected, and a root that is merely unaddressable is still refused rather than replaced.
    tags: [backend-api, cli]
  - name: restart-retry-and-ambiguity-retain-roots
    test: spec-cli/src/codex-runtime-generations.test.ts
    description: >
      Restart after a coordinator crashes with a dead owner lock and a fully-proved pending endpoint, retry a
      completed switch, then replace or corrupt one draining generation's identity while current traffic remains
      available.
    expected: >
      Retry publishes the one proven pending endpoint without another spawn and reclaims only a dead-owner lock.
      An ambiguous identity refuses reclaim and retains both the draining and current roots; only a zero-reference
      exact identity may be reclaimed.
    tags: [backend-api]
---
