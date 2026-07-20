---
scenarios:
  - name: fresh-python-discovers-source
    description: >
      In a throwaway git repo with the fresh-adoption config, track Python product files alongside
      conventional Python tests, docs, vendored/generated/build paths, metadata, and a binary. Run
      `spex spec lint` through the real CLI and read the coverage transcript.
    expected: >
      Every tracked regular text file is reported uncovered, including Python, README/docs, vendor,
      generated/build, metadata, and text assets. Conventional tests, the binary, untracked files, and
      SpexCode-owned data are absent. No "governing NOTHING" warning appears.
    tags: [cli]
    code: spec-cli/src/lint.ts
  - name: typescript-configured-policy-and-empty-set
    description: >
      Run `spex spec lint` in TypeScript temp repos with default tracked-text discovery, configured
      include/exclude globs, extension compatibility, and an include policy that deliberately matches nothing.
    expected: >
      Default discovery includes product, docs, and build text while tests stay excluded. Configured globs
      select and subtract exactly their matches. Dotted `sourceExtensions` contributes include globs through
      the same union. The deliberate empty set gets "governing NOTHING" naming roots, includes, excludes,
      tests, and their `lint` repair knobs.
    tags: [cli]
    code: spec-cli/src/lint.ts
---

# adopt-nonweb-ergonomics — how its loss is measured

YATU through the real `spex spec lint` CLI, never by reading implementation helpers. Stand up throwaway git
repos shaped like fresh Python and TypeScript adopters, plus configured-policy and empty-set cases, run the
CLI from each repo root, and compare the emitted coverage transcript with the set algebra above.
