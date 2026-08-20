---
title: anchor-gold
status: active
hue: 150
desc: A frozen, language-neutral anchor corpus and scorer for declaration Units across TypeScript/TSX, Python, Go, Rust, Java, and Ruby.
code:
  - spec-eval/bench/anchor-gold/score.ts
related:
  - spec-eval/bench/anchor-gold/manifest.json
  - spec-eval/bench/anchor-gold/truth.json
  - spec-eval/bench/anchor-gold/corpus/go-ambiguous.go.snap
  - spec-eval/bench/anchor-gold/corpus/go-bad.go.snap
  - spec-eval/bench/anchor-gold/corpus/go-basic.go.snap
  - spec-eval/bench/anchor-gold/corpus/java-ambiguous.java.snap
  - spec-eval/bench/anchor-gold/corpus/java-bad.java.snap
  - spec-eval/bench/anchor-gold/corpus/java-basic.java.snap
  - spec-eval/bench/anchor-gold/corpus/python-ambiguous.py.snap
  - spec-eval/bench/anchor-gold/corpus/python-bad.py.snap
  - spec-eval/bench/anchor-gold/corpus/python-basic.py.snap
  - spec-eval/bench/anchor-gold/corpus/ruby-ambiguous.rb.snap
  - spec-eval/bench/anchor-gold/corpus/ruby-bad.rb.snap
  - spec-eval/bench/anchor-gold/corpus/ruby-basic.rb.snap
  - spec-eval/bench/anchor-gold/corpus/rust-ambiguous.rs.snap
  - spec-eval/bench/anchor-gold/corpus/rust-bad.rs.snap
  - spec-eval/bench/anchor-gold/corpus/rust-basic.rs.snap
  - spec-eval/bench/anchor-gold/corpus/ts-ambiguous.ts.snap
  - spec-eval/bench/anchor-gold/corpus/ts-bad.ts.snap
  - spec-eval/bench/anchor-gold/corpus/ts-basic.ts.snap
  - spec-eval/bench/anchor-gold/corpus/tsx-ambiguous.tsx.snap
  - spec-eval/bench/anchor-gold/corpus/tsx-bad.tsx.snap
  - spec-eval/bench/anchor-gold/corpus/tsx-basic.tsx.snap
---
# anchor-gold

This benchmark freezes source snapshots and hand-reviewed `Unit` labels. Each language has a normal
declaration sample, a duplicate-name sample that must remain ambiguous, and malformed syntax that an
extractor must reject. The scorer is deliberately outside the anchor implementation: it loads a pure
extractor at runtime and reports name `precision`/`recall`, exact inclusive line ranges, ambiguity, and
bad-syntax refusal per language. Missing extension claims are reported as `UNSUPPORTED`, never as a pass.

The truth file is the source of the expected ranges. Ranges are 1-based and inclusive, matching the
`Unit` contract in [[code-anchor]]. The scorer awaits extractor readiness and each extraction, so a lazy
runtime changes no score semantics. `--strict` requires exact name multisets and ranges as well as ambiguity
and malformed-source refusal; it cannot report a partial language as a release pass. Existing snapshots are
immutable; corpus growth adds a new id.
