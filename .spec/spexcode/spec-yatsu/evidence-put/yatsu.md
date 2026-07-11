---
scenarios:
  - name: put-idempotent
    tags: [cli]
    code: spec-yatsu/src/cli.ts
    related: [spec-yatsu/src/cache.ts]
    description: >
      Through the real CLI: `spex evidence put <file>` a binary file twice and once via stdin
      (`spex evidence put -` fed the same bytes), capturing the printed hash each time. Confirm the
      blob exists at `.git/spexcode/evidence/<hash>` in the shared common dir. Then `spex evidence put`
      an empty input.
    expected: >
      All three puts print the SAME 64-hex hash (content-addressed idempotence — re-putting is the
      documented repair for a clone whose cache lacks a referenced blob) and exit 0; the blob lands
      once in the per-clone `.git/spexcode/evidence` cache. An empty input is refused loudly (exit 2,
      "refusing an empty blob") — never a hash for nothing.
---

Measured YATU through the installed `spex` CLI — real `evidence put` invocations from a shell comparing
printed hashes, never by calling `putBlob` directly.
