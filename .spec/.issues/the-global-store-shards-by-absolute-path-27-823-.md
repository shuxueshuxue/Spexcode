---
concern: the global store shards by absolute path — 27,823 project dirs for 37 real ones, and the same repo on two machines is two stores
by: 53f55aa4-83cc-4bb9-95a8-c75666b33d51
status: open
nodes: runtime, portable-layout, project-identity
created: 2026-08-05T16:57:08.514Z
---

Spec: runtime, portable-layout, project-identity

The global store keys a project by its **absolute path** — `project-store.ts:11` slugs the root with
`root.replace(/[/.]/g, '-')`. Measured by @2c787e87 this run in `~/.spexcode`:

| Population | Count |
|---|---:|
| project directories | 27,823 |
| projects that actually hold a session | 37 |
| slugs of a `/tmp/...` path (e.g. `-tmp-spex-commit-gate-…`) | 25,373 |
| pure-hex names, writer NOT traced | 2,450 |

The 2,450 hex names are **untraced, not attributed** — nobody followed them to a writer, so this
issue does not claim to know what makes them.

## Two defects, and only one of them is narrow

**(a) Narrow — a temp root should not mint a permanent directory.** `spexcodeHome()` honours
`SPEXCODE_HOME` but defaults to the real `~/.spexcode`, so every run against a throwaway root leaves
a permanent dir in the user's home. 25,373 of them came from commit-gate runs. The fix is at the
callers that create temp roots (set `SPEXCODE_HOME` alongside the temp root): it changes no identity
model, no outward contract, and no live deployment's store. This one is a legitimate default next
move for whoever owns the gate harness.

**(b) Not narrow — path-as-identity is the real finding, and the dirt is only its symptom.** Session
records, endpoint records and per-tree materialize slots are ALL sharded by path, which means:

- the same repository on two machines at different paths is **two unrelated stores** — and this
  project's own deployment is a fleet where exactly that is normal (the same clone lives at
  `~/specMech`, `~/spexcode`, `~/Codebase/...` on different hosts);
- `mv` on a checkout **silently orphans** every session record, endpoint and materialize slot it had.
  Silently is the operative word: nothing reports the old store, so the symptom is "my sessions
  vanished", not "your key changed".

That second half is a store-identity question ([[project-identity]] is where it belongs), and its
blast radius is every project directory in a user's home. It is not something to change on a night
run, so no worker is dispatched for it.

Worth pairing with the diagnostics theme already filed as
`a-failed-read-reports-the-absence-but-never-the-`: `no such session: 99999999` names neither the
store it consulted nor the project it resolved the cwd to — and there are 27,823 candidates. The
27,823 is what makes that silence expensive, which is why the two are filed separately rather than
merged into one line.
