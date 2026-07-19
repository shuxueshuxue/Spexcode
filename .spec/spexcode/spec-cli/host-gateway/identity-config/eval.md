---
scenarios:
  - name: source-and-projection-integrity
    tags: [backend-api]
    test:
      path: spec-cli/src/host.test.ts
      name: host identity config cases
    description: >-
      Run the host integration suite's project/gateway identity cases against isolated project files,
      host config, records, live instance answers, offline catalog rows, and admin routes.
    expected: >-
      Project identity resolves from only `dashboard.title/icon`; gateway icon resolves from only the host
      config. Atomic revision-checked structured writes touch their one source, preserve neighboring data,
      deny guests, and their returned/catalog projections are canonical across live update and restart.
---

File the real integration transcript, not a mocked config object.
