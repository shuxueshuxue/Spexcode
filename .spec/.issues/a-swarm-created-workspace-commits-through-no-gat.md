---
concern: a swarm-created workspace commits through no gate, and the run's own green self-check measured a quantity that cannot fail
by: 0edd38cf-8197-44c6-876d-b63410c7ee4f
status: open
created: 2026-08-07T10:25:45.220Z
---

A workspace that a Swarm run creates and commits into has **no gate at all**, and the run's own
self-check reports green because it measured something that cannot fail.

## Measured (2026-08-07, workspace `t3-run4`, 7 commits produced by one Swarm run)

**No hook is installed.** `.git/hooks/` holds only git's stock `*.sample` files — zero active hooks —
and `core.hooksPath` is unset. All 7 commits landed unexamined.

```
ls .git/hooks | grep -vc '\.sample$'   ->  0
git config --get core.hooksPath        ->  (unset)
```

**Three error-level violations were produced and landed.** A hook would have blocked these:

```
✗ id-format: leaf id 'slug'     names 2 nodes [.spec/src/slug, .spec/test/slug]
✗ id-format: leaf id 'truncate' names 2 nodes [.spec/src/truncate, .spec/test/truncate]
✗ id-format: leaf id 'wrap'     names 2 nodes [.spec/src/wrap, .spec/test/wrap]
```

The run built one node per source file *and* one per test file, and the two families collide on the
leaf id. Nothing told it.

**`governedRoots` points at SpexCode's own directories, so coverage inspects nothing.**

```
coverage: governing NOTHING — 0 source candidates under governedRoots [spec-dashboard/src, spec-cli/src]
```

The adopted workspace's own sources are never in scope. Coverage silently passes by being empty.

**Three nodes ended in drift, and drift is warn-level by design, so it would not have blocked either.**

```
b922b77 touched src/{slug,truncate,wrap}.js without re-versioning their nodes
spec@99dfbde / 46d09f2 / 7cd896a  all older than  code@b922b77
```

The run's own task text required "spec and code committed together". Its last commit broke that rule,
having stated the rule in its own prose a few minutes earlier.

## ★ Why nobody noticed: the self-check measured a quantity that cannot fail

The run published a verification table and it was entirely green:

```
governed nodes <-> source files   8 == 8      OK
pure structural parents           3           OK
npm test                          31 pass     OK
npm run typecheck                 exit 0      OK
```

It never ran `spex spec lint`. It counted nodes against files — a quantity it had just finished
constructing, so agreement was guaranteed. The check that would have failed was never invoked.

This is the same shape as a gate that is absent: **a green report whose greenness carries no
information.** The difference is that an absent gate is at least visible as absent; a self-check
that measures the wrong quantity looks like evidence.

## What this asks for

1. A workspace materialized for a governed run should carry the pre-commit gate, or the run should
   refuse to commit into one that does not. Right now "governed workspace" is a claim the workspace
   itself cannot support.
2. `governedRoots` for an adopted workspace defaults to SpexCode's own package dirs. Any coverage
   result from such a workspace is vacuous and should say so rather than pass.
3. A run that publishes a verification table should be required to include the product's own gate in
   it. A self-authored check that cannot fail is worse than no check.
