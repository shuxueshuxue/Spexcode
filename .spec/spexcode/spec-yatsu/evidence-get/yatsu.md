---
scenarios:
  - name: roundtrip
    description: >
      Through the real CLI: `spex evidence put` a file with known non-trivial bytes (e.g. a PNG — binary,
      not text) and capture the printed hash. Then `spex evidence get <hash> -o <out>` and `spex evidence
      get <hash> > <piped>` (no backend needed — this is the local-cache path) and compare each output to
      the original byte-for-byte (cmp/sha256). Then `spex evidence get` a well-formed 64-hex hash that was
      never put: it must exit non-zero and the stderr must name BOTH paths tried — the local cache path
      and the backend URL with its failure — never exit 0 with empty output.
    expected: >
      Both `get` outputs are byte-for-byte identical to the original file (exit 0). The unknown hash
      fails loud: non-zero exit, stderr names the local cache path and the backend /api/evidence URL
      it tried.
    tags: [cli]
    code: spec-yatsu/src/cli.ts
---

Measured YATU through the installed `spex` CLI — real `evidence put` / `evidence get` invocations from a
shell, comparing real bytes with `cmp`/`sha256sum`, never by calling `readBlobByHash` directly.
