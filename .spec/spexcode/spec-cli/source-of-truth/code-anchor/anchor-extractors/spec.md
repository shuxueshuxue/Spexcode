---
title: anchor-extractors
status: active
hue: 15
desc: Extraction is a language seam: pure (content, filename) → units functions, one Tree-sitter WASM runtime, each language a DATA row with its grammar and declaration rules; an unparseable file is a loud integrity error that leaves its anchors unverified, never a fake pass.
code:
  - packages/spec-core/src/anchors.ts#treeSitterExtractor
  - packages/spec-core/src/anchors.ts#treeSitterLanguage
  - packages/spec-core/src/anchors.ts#unitsAtFileRevision
  - packages/spec-core/src/anchors.ts#fileRevisionMemoKey
related:
  - spec-cli/src/anchors.test.ts
  - spec-cli/src/lint.ts
  - spec-cli/src/guide.ts
---

# anchor-extractors

Below [[code-anchor]]'s resolver sits the one place SpexCode reads source structure. A language enters as a row,
never as a resolver branch, and everything above the seam — memoization, dead/ambiguous resolution, hunk∩range —
stays language-agnostic.

**Extraction is a language seam.** Extractors are pure `(content, filename) → units` functions (no
git, no cache, no fs — importable by an external scorer as-is), and every extension maps to exactly
ONE designated extractor — no cross-language or cross-engine fallback. The precise extractor for every
shipped language is the same Tree-sitter WASM engine; a language is a DATA row carrying its grammar,
extension set, declaration-node rules, qualified-name rules, and extractor schema. The initial rows are
TypeScript/TSX, Python, Go, Rust, Java, and Ruby. Adding a language adds a row and grammar asset, never a
new resolver branch. The runtime and grammar assets are SpexCode package inputs, so adopters do not need
the language's compiler or a host parser dependency. The runtime is initialized lazily; an unavailable
runtime, missing grammar, incompatible grammar ABI, or parse error is an explicit `integrity` error and
leaves the affected anchors unverified rather than silently selecting another parser or returning a fake
pass. Tree-sitter's error-recovery tree is therefore rejected when its root reports `hasError`.

That strictness has a cost the rejection message must carry: a shipped grammar can lag its language, so a
file rejected here is not necessarily invalid source. The pinned TypeScript grammar, for one, parses
`import('mod').Type` but not the array over it, `import('mod').Type[]`. And because a rejection is
file-wide while a session's scope spans many nodes, ONE such file makes every selector into it
unextractable and, through [[session-eval]]'s explicit-unavailable rule, takes down every session's eval
summary at once — the loudest possible failure wearing the quietest possible face, a toolbar that reads
"unavailable" and names no cause. So the message names the file and the engine's verdict, and the honest
remedies are the grammar row and the source construct, never a softened gate: a parse this engine cannot
certify may not be reported as a hit or a no-hit.

The place to meet that cost is the ref-change gate, at the moment the construct is written, and the
population it must cover is EVERY declared selector. A selector's declaration site — a node's frontmatter
or a scenario's `code:` in an eval.md — decides who repairs it, never whether it is checked: both write
`path#unit` and both arrive here. [[spec-lint]] owns that gate and refuses an unresolvable selector from
either site as one integrity error. A file no node anchors but many scenarios do was, before that, a file
this engine parsed constantly and no gate ever asked about.

The extractor contract stays language-agnostic above the seam: immutable file-revision memoization,
dead/ambiguous resolution, and hunk∩range all live outside it. A memo key includes every input to the
extractor: object-hash algorithm and blob oid, filename semantics (including script kind), extractor/schema
identity, grammar/runtime identity, and normalized query configuration; same bytes under `.ts` and `.tsx`
therefore never share a result by oid alone, and the result is independent of call order. Within one READ
— a lint run, a board build, a CLI scan — every live anchored window is handed to the engine at once: it
reads a historical `(commit,path)` image, its blob, and an ordinary `(commit,path)` hunk once, then applies
each node's own selector set and emits findings in declaration order.

The Tree-sitter rows preserve one shared declaration vocabulary. TypeScript/TSX expose top-level functions,
classes and class methods, simple variable declarations, enums, interfaces, and type aliases; Python
exposes `def`, `async def`, and classes with lexical qualification; Go exposes constants, types, functions,
and receiver methods (`Command.SetArgs`); Rust exposes constants, structs, enums, traits, functions, and
impl methods (`Command.set_args`); Java exposes classes, final fields, constructors as `Class.constructor`,
and methods (so overloads remain ambiguous); and Ruby exposes constants, methods, singleton methods,
classes, and modules with enclosing class/module qualification. Decorators and declaration ranges come from
the syntax nodes. Dynamic
callables, imported aliases, macro-generated declarations, and runtime-attached methods remain outside the
capability. Unsupported names fail as dead anchors, and duplicate qualified declarations stay ambiguous
through the same language-agnostic resolver used by every extractor.
