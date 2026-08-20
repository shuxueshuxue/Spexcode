---
scenarios:
  - name: installed-package-preserves-canonical-message-bytes
    tags: [backend-api]
    description: >
      Install the packed package into a clean directory outside the repository, run all six public operations and a
      multi-process shared-database case, and compare the enqueued and read message bodies, headers, identifiers, and
      hashes through the installed public entry.
    expected: >
      All six operations complete, three independent processes agree on committed state, opaque body bytes and
      headers round-trip exactly, message identifiers have the protocol format, and the reported hash matches the
      independently constructed canonical bytes.
---
# session protocol message envelope loss

The installed package is the measured surface. The transcript includes the exact byte and process counts and the
independent hash comparison rather than reporting a bare success flag.
