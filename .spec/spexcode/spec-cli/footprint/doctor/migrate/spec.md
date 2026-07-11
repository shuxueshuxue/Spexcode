---
title: migrate
status: active
hue: 160
desc: "`spex doctor --migrate` — the one-shot 0.2.x → 0.3.0 migrator for an adopter repo: tree renames, hash-gated hook-asset upgrades, executable-surface vocabulary rewrites; refuses loudly, stages everything, guesses nothing. Ships with 0.3.0, deleted in 0.4.0."
code:
  - spec-cli/src/migrate.ts
related:
  - spec-cli/src/migrate-table.ts
  - scripts/gen-migrate-table.mjs
---
# migrate

## raw source

v0.3.0 renamed the tool's whole vocabulary in one breaking cut, and an external adopter's repo (gugu's
~105 nodes, z-code's ~417) is DATA the release cannot reach: its committed `.spec` tree still says
`.config`, `yatsu.md`, `spex board` — so the new CLI refuses its plugin surface loudly and its filed
measurements dangle invisibly. Those adopters install from npm; they never see this repo's scripts. So
the migrator ships INSIDE the release as `spex doctor --migrate` — a named, term-limited artifact
(0.3.0 in, 0.4.0 out; a released one-shot migrator is not a runtime residue), housed on [[doctor]]
because it is the repair verb behind doctor's diagnosis: the same command that tells you the tree
predates v0.3.0 carries the flag that fixes it.

## expanded spec

One run migrates a 0.2.x tree completely or not at all. ALL preconditions are checked before the first
write — clean tracked tree, `.spec` in git, main checkout, zero session records (drain first: closed
sessions keep no record, so ANY record refuses), no rename collisions, not already migrated (a second
run refuses on `.plugins` existing) — and any failure prints every refusal and exits 2 untouched.

The rewrite has three honesty tiers, strictly ordered by how much we KNOW about the bytes:

- **Renames** (`git mv`, history-preserving): `.config` → `.plugins`; `yatsu.md` → `eval.md`;
  `*yatsu.evals.ndjson` → `*evals.ndjson`; a node named `config` → `plugin-system` ONLY when its spec.md
  blob-matches a stock version of spexcode's own plugin-system spec — an adopter's own `config` node is
  flagged, never renamed. The per-clone evidence cache dir rides along (`yatsu-blobs` → `evidence`).
- **Hook assets** (the dangerous half): a `.plugins` file is replaced wholesale by the shipped template
  ONLY when its git blob sha matches a KNOWN historical stock version. That table
  (migrate-table.ts) is GENERATED from this repo's own git history by gen-migrate-table.mjs — every blob
  each template ever shipped as, across the template tree, the preset packages, and the live `.spec`
  copy — never hand-typed; re-run the generator when templates change. A file matching no known version
  is hand-customized: flagged for review and left byte-identical. Retired-stock files (shipped once,
  gone now) are reported; their .md bodies still get the vocabulary pass (the bytes are provably ours),
  their scripts stay frozen.
- **Vocabulary pass** over remaining `.spec` markdown (issue threads included): rewrites only what is
  EXECUTED or PARSED — old command spellings to their one §3.1 home, `yatsu-*:` lint labels,
  renamed API routes, measurement file names, `[[mention]]`s and `nodes:` bindings of nodes THIS run
  renamed, `.spec`-internal `.config` paths. Conceptual prose is not forced. Dead spellings with no
  deterministic home (`spex review proof`, `spex issues on|off`, a bare old `spex eval <SEL>`) are
  flagged with file:line, never guessed at. The legacy `proposals.enabled` settings key becomes
  `issues.enabled` (the runtime reads only the new key).

Everything lands STAGED, nothing committed: the operator reviews the staged diff plus the flag list,
commits through the ritual, then re-plants per-clone hooks and restarts the backend (the summary names
each step; `git reset --hard` undoes the whole run). The run ends with post-checks through the real new
CLI — `spec lint`, `eval lint`, `materialize` — so the migration's claim of success is the product's own
reading, not the migrator's. The proof rig is `rehearsal.sh` beside this spec: it rebuilds a real 0.2.8
adopter from this repo's history and drives the A/B (refusal/dangling before, all-green after, the
migrated stop-gate blocking a live undeclared stop), plus the customized-flag and idempotent-refusal
rehearsals.
