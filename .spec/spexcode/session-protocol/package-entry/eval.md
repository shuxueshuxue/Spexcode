---
scenarios:
  - name: installed-package-exposes-only-the-frozen-entry
    tags: [backend-api]
    description: >
      Pack the package, install only that tarball into a clean external consumer, import the package by name, inspect
      its runtime keys and declarations, run all six operations, and complete the independent two-writer/one-reader
      shared-database case.
    expected: >
      The installed runtime and declarations expose every frozen public symbol and no connection, inspection,
      alternate-open, or partial-write symbol; the six-operation loop passes; and three processes agree on one
      committed database using only the package-name import.
---
# session protocol package entry loss

Only a tarball installation can measure this boundary because repository-relative imports bypass package exports and
published files. The transcript reports the expected and actual runtime key populations alongside operation and
process counts.
