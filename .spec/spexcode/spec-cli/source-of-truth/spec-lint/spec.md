---
title: spec-lint
status: active
session: sess-cmdline
hue: 175
desc: Deterministically keep the spec↔code graph and authored contracts structurally honest; `spex spec lint` is the production gate.
code:
  - spec-cli/src/lint.ts#specLint
  - spec-cli/src/lint.ts#loadConfig
related:
  - spexcode.json
  - spec-cli/templates/hooks/commit-msg
  - spec-cli/templates/hooks/reference-transaction
---
# spec-lint

## raw source

A spec is the ground truth for the code it governs, but nothing tied the two together, so code could
drift from its spec silently. The missing edge is a `code:` list in each node's frontmatter naming the
files it owns, plus a deterministic linter over that graph. Keep the spec↔code **graph and authored
contract structure** honest; whether prose is semantically good, including whether it sits at the right
altitude or whether its tree shape is too broad, is an opt-in health diagnosis rather than a production
gate. The graph's NAMES are part of its honesty too: an id is an unambiguous coordinate, a `[[mention]]`
must resolve, and a retired vocabulary must stay retired.

## expanded spec

`spex spec lint` (`cli.ts` → `lint.ts`, over `loadSpecs()` from `specs.ts`) checks the graph and
deterministically verifiable contract structure. Errors block; warnings advise. The full registry (every
rule, its level, its one-line meaning) is printed by `spex help spec` and `spex guide spec` — the manual
lists ALL lint rules, always:

- **integrity** (error): every file a spec lists in `code:` exists — broken links block. A SELECTOR
  (`path#symbol` on either relation, [[code-anchor]]) must also resolve: dead (unit deleted/renamed),
  ambiguous (two same-named units), or an unparseable file all error with the repair spelled out. A
  language with no designated extractor remains an integrity error. A designated extractor whose
  dependency cannot run here is different: lint emits an explicit extractor-unavailable **integrity
  error**, names the repair, skips that language's anchor checks, and continues; the non-zero result
  records that the anchor is unverified, never a silent or falsely passing result. So do a relation's
  structural defects: a duplicate entry, a base path both bare and selector-scoped, and a selector on
  a glob or directory. Candidate lint also rejects deleting a governor while its governed subject remains
  present without transfer to another node; deleting the implementation with the node is valid retirement.
- **anchor-drift** (error): a commit since the node's version intersected an ANCHORED unit's line
  range (measured from the file as it existed at each commit) with no covering Spec-OK ack — the
  blocking tier of drift, replacing the retired count-based `driftErrorThreshold` gate. Same-file
  selectors are OR'd: one error per entry, hit selectors named, each commit counted once. Ordinary commits
  use their normal hunk; a merge uses only dense combined hunks different from every parent, so conflict
  resolution is visible while clean `--no-ff` transport is not charged twice. See
  [[code-anchor]].
- **one-govern** (error): a node governs (`code:`) at most ONE file — DISTINCT base paths, so several
  selectors on one file are one subject — and drift/eval/ack have one unambiguous subject; keep the
  true subject, demote the rest to `related:` ([[governed-related]]).
- **living** (error): a body stays current-state, with no `## vN` changelog headings — version history
  is read from git (recent/history tabs), not duplicated in prose. Fence-aware: a `## v2` inside a ```
  block is sample text, not a violation.
- **id-format** (error): a node's id — its leaf dir basename — passes an **exact per-character
  whitelist** and is **unique tree-wide**. This bullet is THE id vocabulary: defined once, here;
  [[mentions]] and [[id-url-safe]] reference it, never restate it. The table, judged on NFC (the
  mint's canonical form), deterministically and with no heuristics:
  - **allowed**: ascii `[a-z0-9-]`; any **non-ascii unicode letter or number** — CJK and every other
    letter script is a first-class id, exactly what the resolve machinery accepts; one optional
    **leading dot** (the reflexive `.plugins` root).
  - **forbidden** (by construction — anything off the whitelist): space, `/`, **uppercase Latin**
    (lowercase is the Latin norm), control characters, and `_` — reserved as the mint's
    parent-qualification join, which is also why a mention TOKEN accepts `_` while a dir name never
    contains one.

  Uniqueness keeps the leaf THE id: on a collision the mint ([[id-url-safe]]) must parent-qualify,
  and every surface suddenly speaks a longer id than the dir name.
- **mention** (error): every `[[id]]` in body PROSE names a real node — a dangling mention is a broken
  edge in the very graph the tree keeps honest. Retarget it or drop it; a placeholder (`[[node]]`,
  `[[<id>]]`) belongs in a fence or inline code span, which the rule exempts as sample text.
- **coverage** (warn): every source file is claimed by ≥1 spec via `code:` **or** `related:`. Source is
  enumerated from **git-tracked** files (`git ls-files`), so `governedRoots: ["."]` safely means the whole
  project. The source set is one explicit algebra: current regular text under those roots, selected by
  optional `sourceIncludeGlobs`, minus SpexCode-owned data, `sourceExcludeGlobs`, and `testGlobs`. There is
  no guessed language/path/file-type blacklist. The compatibility `sourceExtensions` lowers into include
  globs before that same matcher. Eval lint reuses the resulting tracked set, and an empty set warns
  "governing nothing" with every active policy knob. See [[adopt-nonweb-ergonomics]].
- **drift** (warn): a governed file has commits not reachable from its spec's latest version — true git
  ancestry ([[drift-by-ancestry]]), never a log-position/date guess → maybe stale. A file
  governed by several nodes drifts **every** owner — shared governance is ordinary, and each has a stake.
  ALWAYS advisory: unanchored drift never blocks a commit; the blocking tier is **anchor-drift** above.
  On a selector-scoped file's MISS this advisory stays by default; the committed
  `lint.scopedCodeMiss: "ignore"` silences only it ([[code-anchor]]).
- **related-drift** (warn): the SOFT tier — a `related:` file moved ahead of the node; one summary line,
  never the commit gate, never eval freshness. A selector-scoped related row warns per HIT (selector
  named); its misses are silent.
- **owners** (warn): one summary line counting files governed WHOLE-FILE by **> `lint.maxOwners`** nodes
  (default 3) — breadth's mirror on the file (too many owners, not too many children; below the cap is
  ordinary). A selector-scoped governor claims units, not the file, so it stays out of the count. Remedy
  blames the FILE: **split** it so each governor owns a module, or merge the nodes, or give it a single
  foundation owner + **`related:`**. See [[governed-related]].
- **confusable-id** (warn): two leaf ids exactly one edit apart read as the same word — a typo in either
  reaches a real, wrong node. Deliberately conservative (distance 1 only): hierarchy naming like
  graph/graph-delivery and verb pairs like evidence-put/evidence-get never warn — better to miss a
  borderline pair than to nag legitimate siblings. Distance counts **code points**, script-agnostic: a
  CJK pair one character apart (节点/结点 — the classic homophone IME slip) warns like an ascii pair,
  and a pure-CJK id never sits one edit from a pure-ascii one, so mixed-script trees get no cross-script
  false positives.

Beside the graph rules sits the **vocabulary backstop**, [[dead-words]]: a CI grep gate over the RENAMED
concepts' old names, scoped to product surfaces (strings, file names, node dir names) with prose exempt —
lint keeps the graph honest, dead-words keeps its language from regressing.

Heuristic spec health is deliberately absent from this registry. Bare [[doctor]] owns the opt-in health
diagnosis, including the one altitude implementation and the one breadth implementation; lint neither
emits those findings nor carries their thresholds into the commit hook or CI. The retired
`lint.maxChildren` key is not a compatibility fallback: doctor names it and its
`doctor.breadth.maxChildren` replacement so an old settings file cannot silently keep a second owner.

Reusable as a **product**, not a SpexCode-only script: every project-shaped value (roots, source policy,
and ownership bounds) is read from an optional **`spexcode.json`** (`lint` key), defaulting to values tuned
to this tree; a different layout or language overrides what fits. `loadConfig` reads it through the shared
fail-loud `readJsonConfig` ([[portable-layout]]): an ABSENT file defaults silently, but a MALFORMED one
throws LOUD rather than quietly reverting the author's policy to defaults — a typo that green-washes the
very coverage or structural warnings they meant to enforce is a config error they must see.

No file hashes are stored — git is the hash database, so drift is derived live. When
drift exists, `spex lint` prints **remediation guidance**: drift can't be auto-fixed, so the agent must
find which link of intent→spec→link→structure→code broke and fix THAT — *never patch the symptom*.
**One anchor predicate at two real tips, plus candidate transition integrity:** the retired count gate
(`lint.driftErrorThreshold`) stays gone; an anchor hit is an ordinary lint ERROR. `spex spec lint` and CI
judge committed `HEAD`. On commit paths that
invoke it, `commit-msg` arms one candidate and `reference-transaction` invokes the same lint over the real
new oid before its ref advances,
so history, raw specs, config and current anchored source all come from the candidate tree — never from an
unrelated worktree/index state. Pending indices are transient and shared only inside that lint run; they
never occupy or evict the server's persistent HEAD-keyed cache. Unanchored drift remains advisory. The
candidate-only integrity rule above is intentionally not this shared anchor predicate: it compares deleted
governor blobs from old `HEAD` with ownership in the candidate tree and rejects an orphaned surviving
subject. Once that transition has landed, current `HEAD` no longer contains the deleted claim, so default
lint reports only current-tree coverage; this local transition guard preserves the information while both
sides are available. It is satisfied by deleting the implementation or transferring ownership, never by a
`Spec-OK` trailer.

This candidate gate intentionally supersedes the earlier **"One gate, no staged-index machinery"**
decision rather than pretending that decision was an oversight. At that time `Spec-OK` existed only as a
later `spex spec ack` `--allow-empty` stamp; there was no content-bearing ack, so rejecting before the
implementation commit existed would close the only honest mechanics-only route. Native in-commit trailers
now supply that route, while the narrowly-armed ref transaction lets the existing ancestry engine judge the
real exact commit without applying a gate to unrelated ref operations. Local is therefore stricter than CI on paths that
reach this hook: `P1` changing anchored code and
`P2` updating the spec is accepted at CI's final tree but local rejects `P1`, deliberately requiring the
code/spec checkpoint to be one commit. Bypass the local hook explicitly with `SPEXCODE_SKIP_LINT=1`; no
installed hook means no local enforcement, so [[ci-gate]] remains authoritative.

### Spec-OK — acknowledging an implementation-only change

A commit ahead of a spec isn't always staleness — a refactor can change a governed file while the spec
stays true. Its **`Spec-OK: <node-id>`** trailer names the node it acknowledges (`Spec-OK: A` quiets only
A). An ack covers reachable ancestors only when it has exactly one parent and the same tree as that sole
parent. Every other ack is self-only, including a merge with an unchanged first-parent tree: the merge
still introduces newly reachable history. `spex ack <node>… --reason "<why>"`
stamps the trailer on an **empty commit
above HEAD** (`--allow-empty --only`, so a dirty index never rides along) — never an amend: drift's read
side quiets every drift commit *reachable* from an ack, so a child stamp covers exactly what amending
would, and it works on a trunk merge commit, where an amend re-authors the merge after `MERGE_HEAD` is
gone and [[main-guard]] rightly rejects it (the guard passes the stamp through its tree-unchanged door;
the same door waives this node's commit-local drift gate for the stamp — a no-content commit can't
introduce drift, and gating it on the REAL index would block an ack on the very drift it acknowledges
whenever unrelated work is staged).
The reason is **required and recorded in the ack commit's message body** — it forces the agent to
articulate why the spec still holds before quieting it, and an ack that quiets an anchor hit
([[code-anchor]]) is a strong claim whose why must be durable. A shared file drifts every governor, so
`Spec-OK:` accepts several ids — one ack per co-owner.

This split is also a correction to the old reader, not only support for a new writer. Before the split, a
content trailer was fed through the checkpoint reachability cover and could silently erase older or
cross-node debt; a tree-identical `ours` merge could do the same for a whole newly reachable side branch.
Both pending and HEAD lint now retain those debts, and report each affected node separately so the author
can name exactly the required nodes in repeated `--trailer` flags.

For the implementation commit currently being authored, Git's own
`git commit --trailer "Spec-OK: <node-id>"` is the in-commit route. The final message is already present on
the real candidate oid the armed gate judges, and a trailer on a content-bearing commit acknowledges
**only that commit** — older unacknowledged drift remains. The commit body is the durable explanation. A
prior ack cannot cover a descendant, and a later empty ack cannot be created through a non-bypassed gate
until the rejected commit lands; this makes the in-commit form necessary for a complete honest workflow.
Hook absence, the explicit bypass, or a meaningless spec edit remain operational ways around truth that
Git cannot prevent.
