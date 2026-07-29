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
  - name: restart-retry-and-ambiguity-retain-roots
    test: spec-cli/src/codex-runtime-generations.test.ts
    description: >
      Restart or retry a switch after current publication, then replace or corrupt one draining generation's
      identity while current traffic remains available.
    expected: >
      Retry returns the already-published current generation without another spawn. An ambiguous identity
      refuses reclaim and retains both the draining and current roots; only a zero-reference exact identity
      may be reclaimed.
    tags: [backend-api]
---
