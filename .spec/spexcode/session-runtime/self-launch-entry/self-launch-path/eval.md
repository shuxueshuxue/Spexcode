---
scenarios:
  - name: installed-cli-selects-only-the-frozen-database-path
    tags: [cli]
    description: >
      Install the packed adopter and protocol into a clean external consumer, then invoke the installed binary in
      separate processes with each of the four path sources and with a relative explicit path.
    expected: >
      The four absolute paths win in the frozen order; the relative path is refused without consulting cwd; no
      parent directory is created; and a missing parent surfaces as PROTOCOL_PATH_PARENT_MISSING with a repair hint.
    code: packages/session-selflaunch/src/path.ts
---
# self-launch database path loss

The measurement uses only the packed binary from an external consumer. Repository-relative imports cannot prove
that the installed path policy is present in the product surface.
