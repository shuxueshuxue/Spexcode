---
scenarios:
  - name: installed-topology-owns-one-component-schema
    tags: [backend-api]
    description: >
      Pack both packages, install their tarballs in a clean external consumer, open one database, inspect component
      migration rows and query plans through public transactions, and exercise checksum drift for topology alone.
    expected: >
      The installed packages create one protocol row and one topology row in the shared registry, both pinned active
      edge query plans use their named indexes, changed topology migration bytes fail checksum verification, and the
      protocol migration remains unchanged.
---
# session topology schema loss

Measure the schema through package-name imports from a clean installation. The transcript reports registry rows and
query-plan details so an empty or repository-relative run cannot count as schema evidence.
