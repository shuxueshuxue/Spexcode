---
scenarios:
  - name: installed-package-opens-one-shared-schema-generation
    tags: [backend-api]
    description: >
      Install the packed package outside the repository, run the full six-operation loop, then start two writers and
      a separate reader process against one fresh absolute database path using only the installed public entry.
    expected: >
      The six operations complete, all three processes use one committed schema generation, both writers' messages
      are visible to the reader, and the evidence reports exactly one protocol migration row rather than inferring
      convergence from process exit codes.
---
# session protocol schema loss

Measure the schema only through a clean installation. The transcript counts migration rows and messages from a
separate process so a process that never reached the shared database cannot be mistaken for convergence.
