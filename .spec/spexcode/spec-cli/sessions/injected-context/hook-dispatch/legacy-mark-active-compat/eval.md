---
scenarios:
  - name: frozen-legacy-mark-active-upgrade
    tags: [backend-api, cli]
    code:
      - spec-cli/hooks/dispatch.sh
      - spec-cli/hooks/compat/mark-active-sed-v0.fixture
      - spec-cli/hooks/compat/mark-active-0.5.2-eef1.fixture
    test: spec-cli/src/hook-dispatch.test.ts
    description: >-
      In an isolated Git project whose tracked standard mark-active hook has either known pre-structured
      historical byte sequence, upgrade to the current package and fire an AskUserQuestion containing quotes
      through the real dispatcher.
    expected: >-
      Both exact historical blobs dispatch to the package-owned structured writer, preserving a parseable
      session record and the quoted note without changing the tracked hook or manifest. A one-byte project
      customization stays on its project handler and is never overridden.
---
