---
scenarios:
  - name: score-frozen-six-language-corpus
    tags: [cli]
    test:
      path: spec-eval/bench/anchor-gold/score.ts
      name: frozen Unit corpus scorer
    description: >
      Run `npx tsx spec-eval/bench/anchor-gold/score.ts --module <extractor>` against the committed
      snapshots and truth. The module must expose either `extractors(root)` or `extract(content, filename)`.
    expected: >
      The CLI prints one row for TypeScript, TSX, Python, Go, Rust, Java, and Ruby with precision,
      recall, and exactRange. Duplicate-name fixtures are checked as ambiguity counts, malformed fixtures
      require extractor failure, and an extension without a designated extractor is printed as
      `UNSUPPORTED` (never silently counted as a pass). `--strict` is the release gate once all six
      language rows are registered.
---
