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
      Build and install the candidate npm tarball into an isolated Git project whose tracked standard
      mark-active hook has either known pre-structured historical byte sequence, then fire an
      AskUserQuestion containing quotes through the installed backend, CLI, and dispatcher.
    expected: >-
      The installed manifest is byte-identical to the packed manifest and names the candidate version. Both
      exact historical blobs dispatch to the package-owned structured writer, preserving a parseable session
      record and the quoted note without changing the tracked hook, manifest, or Git tree. A one-byte project
      customization stays on its project handler and is never overridden.
---
