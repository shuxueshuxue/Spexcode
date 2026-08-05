---
concern: the trunk re-acquired the adopter name within hours of the rewrite — 18 files loaded to publish, and the one anti-leak guard had its own target string redacted
by: 53f55aa4-83cc-4bb9-95a8-c75666b33d51
status: open
nodes: spec-local, ci-gate, harness-adapter
created: 2026-08-05T16:45:04.798Z
---

Spec: spec-local, ci-gate, harness-adapter

The trunk's history was rewritten today to redact an adopter's real name. Within hours the same
trunk re-acquired it: **18 files in main's tree and 9 commit subjects**, all dated 2026-08-05, all
after the rewrite. This is not yet published — it is loaded to publish.

## Exposure state, measured not assumed

- GitHub `origin` is private, so it is not the public surface.
- The public surface is the docs site, which republishes `.spec` **verbatim** from a clone on the
  docs host. That clone currently sits at an older commit: **0 files carrying the name in its tree,
  0 in the built site**. So nothing has leaked yet.
- The documented refresh procedure for that clone after a rewrite is
  `git fetch origin && git reset --hard origin/main` followed by the site rebuild. Running it today
  publishes the name — including a whole spec node **directory** named after the adopter, whose
  `spec.md`, `eval.md` and `evals.ndjson` all go out as prose.

The window is therefore "before the next docs refresh", not "already gone".

## The surface

| Where | Count |
|---|---:|
| `spec-cli/src/harness.ts` (product source) | 1 |
| `spec-cli/hooks/harness.sh` | 1 |
| test files (`harness*.test.ts`, `*-headless.test.ts`, `freshness.test.ts`, …) | 8 |
| the adopter-named spec node dir + its `spec.md` / `eval.md` / `evals.ndjson` | 4 |
| `.spec/spexcode/spec-cli/sessions/harness-adapter/spec.md` | 1 |
| issue bodies | 3 |

The node **directory name** is the worst of these, because the path itself is the disclosure and a
path survives any amount of body redaction.

## Why nothing caught it

`scripts/clean-init-smoke.mjs` holds `FORBIDDEN_ADOPTER_TEXT` — the repo's only anti-leak list. Two
independent reasons it was never going to fire here:

1. **The rewrite edited the guard's own list.** The purge's `--replace-text` pass rewrote the entry
   inside `FORBIDDEN_ADOPTER_TEXT` along with everything else, so the list now contains the
   redacted placeholder `'adopter-a'` and no longer contains the real name. The guard now blocks the
   pseudonym and permits the thing the pseudonym exists to hide. This was **predicted in the purge
   plan itself** ("失去对该名字的拦截") and shipped anyway.
2. **Its scope is the wrong surface.** The assertion at `clean-init-smoke.mjs:191-195` scans
   `outputs` — the files a *fresh adopter's* `spex init` produces — not this repository's tree. Even
   with the real name still in the list it would not have looked at `harness.ts`, a spec body, or a
   directory name.

So the repo has an anti-leak guard, and there is **no gate at all** over the surface that actually
regressed. Fixing (1) without (2) would leave the hole exactly where it is.

## What a real gate looks like

The check belongs where the publishing decision is, not where `init` output is sampled: a list of
forbidden strings, checked against **tracked paths and tracked content** on the trunk, wired into
the gate that already runs on the trunk. Two properties the current one lacks:

- **The list must not live in the redaction's blast radius.** A guard whose target string is
  rewritten by the same pass that redacts the tree cannot survive its own purge. Keep the list
  outside the product repo, or store what to look for in a form `--replace-text` does not match.
- **Paths, not only content.** A directory named after the adopter is a disclosure that content
  redaction cannot reach.

## Not fixing in this thread

Deliberately reported rather than patched, because the cleanup crosses lanes: the adopter-named node
is another session's in-flight work (its body is written but uncommitted, so renaming the directory
now would collide), `harness.ts` is product source under review, and 8 test files reference the name
as fixture text. The one part already done is narrow and mine: the two issue bodies I filed tonight
had their prose redacted (`70ab3552f`); what remains in them is the literal node id, which cannot go
until the node is renamed.

Worth stating plainly: **a redaction that leaves the naming convention undeclared gets undone by the
next honest contributor.** Nine commits re-introduced this without anyone acting in bad faith,
because nothing in the repo says which name to use — the convention lived in a purge plan in a
different repository.
