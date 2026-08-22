# Eval closure batch eleven

Session: `51f57a00`

This is a bounded driver audit for the five remaining `behavioral-benchmark` stale scenarios. It is
ledger-only: no product verdicts or eval rows are filed without the declared real benchmark surfaces.

## Driver audit

| scenario | result | precise reason |
| --- | --- | --- |
| `weak-instruction-single-session` | NOT-MEASURED | The eval declaration requires a real Terminal-Bench task and verifier. The checkout contains no Terminal-Bench runner, task manifest, verifier, or executable driver; only the scenario prose in `.spec/spexcode/session-runtime/behavioral-benchmark/eval.md`. No substitute prompt or unit probe was used. |
| `forced-swarm-write-collection` | NOT-MEASURED | The declaration requires a real write task with isolated workers, commit collection, message dequeue checks, and an independent verifier. No runnable benchmark driver or task fixture exists in this checkout; the only matching tracked material is the scenario declaration and general documentation. No synthetic worker tree was counted as a product run. |
| `layered-session-delivery` | NOT-MEASURED | The declaration requires a real parent/child/grandchild CLI tree and SQLite inspection. There is no declared runner or fixture that can create this benchmark through the real CLI; the scenario remains prose-only. No internal database helper was substituted. |
| `slopcodebench-file-backup` | NOT-MEASURED | The declaration requires the official SlopCodeBench `file_backup` Docker runner and four frozen checkpoints. This repository has no task checkout, Docker runner binding, checkpoint driver, or provider fixture; only `docs/session-slopcodebench-three-problem.md` and `docs/session-slopcodebench-two-problem.md` are present. |
| `slopcodebench-code-search` | NOT-MEASURED | The declaration requires the official SlopCodeBench `code_search` Docker runner and five frozen checkpoints. The required task/runners are absent from this checkout, so a real product measurement cannot be made. No token-limit simulation or prose-only reading was filed. |

## Evidence and boundary

The audit used the repository file inventory (`rg --files`) and the declared eval body. Matching files are the
five scenario declarations plus the two SlopCodeBench design notes; no executable Terminal-Bench or SlopCodeBench
driver is present. This is a driver absence, not a product pass/fail. A future measurement must bring the official
task checkout and runner into an isolated fixture, execute through the real CLI, and file distinct evidence and
scenario hashes at the measured commit.

No product code, scenario prose, specs, acknowledgements, or acceptance artifacts were changed. No `spex eval add`
rows were filed. `git diff --check` and `spex eval lint --changed` are run after this ledger-only commit.
