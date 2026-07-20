---
scenarios:
  - name: fresh-python-discovers-source
    description: >
      In a throwaway git repo with the fresh-adoption config, track Python product files alongside
      conventional Python tests, docs, vendored/generated/build paths, metadata, and a binary. Run
      `spex spec lint` through the real CLI and read the coverage transcript.
    expected: >
      Every Python product file is reported uncovered. Python tests, docs, vendored/generated/build
      paths, metadata, and binary files are absent, and no "governing NOTHING" warning appears.
    tags: [cli]
    code: spec-cli/src/lint.ts
  - name: fresh-typescript-and-empty-policy
    description: >
      Run `spex spec lint` in two more throwaway git repos: one fresh TypeScript project containing
      product and conventional test/build files, and one containing only tracked docs/metadata.
    expected: >
      TypeScript product files are reported uncovered while tests/build output are absent. The repo with
      no default source candidates gets an honest "governing NOTHING" coverage warning naming the default
      tracked-text policy, governedRoots, and the `lint.sourceExtensions` override repair entrypoint.
    tags: [cli]
    code: spec-cli/src/lint.ts
---

# adopt-nonweb-ergonomics — how its loss is measured

YATU through the real `spex spec lint` CLI, never by reading implementation helpers. Stand up throwaway git
repos shaped like fresh Python and TypeScript adopters, plus an empty-candidate repo, run the CLI from each
repo root, and compare the emitted coverage transcript with the expected included, excluded, and fail-loud
paths.
