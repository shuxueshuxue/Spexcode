# Session Behavior Benchmark

This is a product-behavior study, not a collection of unit or fallback tests. The benchmark uses real
Terminal-Bench tasks and the built ZSwarm CLI, with a deliberately short parent instruction. The question is
whether the user-visible task, session tree, protocol messages, and isolated worktrees agree about what happened.

## Method

- Product under test: z-code `local/zswarm-spexcode-runnable` at `d97c3e87e`.
- Harness: compiled `zcode` CLI, real model/provider, `ZCODE_FEATURE_SWARM=1`.
- User instruction: solve the task directly, do not ask questions, choose decomposition when useful, and report
  the result.
- Success is checked by the benchmark's independent verifier, not by the model's final prose.
- Protocol state is checked from the SQLite database after the process exits: topology edges, message dequeue
  timestamps, and child lifecycle/proposal state are separate observations.

The benchmark source is the official [Terminal-Bench repository](https://github.com/laude-institute/terminal-bench),
which defines tasks as real terminal environments with task instructions and independent tests.

The same method was extended with three official SlopCodeBench tasks in
[the follow-up study](session-slopcodebench-three-problem.md): SQLite migrations, dynamic code generation, and a DAG
execution DSL. Those runs add a second incomplete-turn shape to the contract: a tool call or provider turn can start
without ever yielding a tool result or assistant completion. A bounded cancellation of that state is not success and
must not be projected as a successful idle session. Evaluator output is separate evidence; an empty snapshot whose
Docker setup is still waiting for dependencies is not a product score.

## Runs

### Weak instruction, no forced Swarm

| task | product path | independent result | process |
| --- | --- | --- | --- |
| `sqlite-db-truncate` | one session directly recovered `recover.json` | 8/8 known rows | exit 0 |
| `deterministic-tarball` | one session wrote and committed `build.sh`; official verifier | 12/12 | exit 0 |

The parent did not invent a worker tree for either task. This is correct behavior: decomposition is not itself a
goal, and a single session can complete a task without creating unnecessary coordination state.

### Forced Swarm, adopted consumer, read-only worker behavior

The same `sqlite-db-truncate` task was run in a consumer containing a real `spexcode.json`. The parent was required
to dispatch three isolated workers and then synthesize the result. The model chose investigation-only roles.

Observed facts:

- The final `recover.json` was correct (10 rows; the benchmark ceiling was reached).
- The protocol database contained one parent, three child sessions, and three parent-to-child topology edges.
- Nine protocol messages were persisted and all nine had a dequeue timestamp.
- The child worktrees remained isolated and contained their investigation artifacts.
- The parent and all three children were still represented in the durable database after the CLI process exited.
- Each child was `need_review` / `awaiting` with a `merge` proposal, because none had created a commit.
- The CLI reported `worker(s) were dispatched but committed nothing` and did not claim delivery.

This is not a lost-message result. The protocol and topology observations agree, and the parent obtained enough
information to produce the correct artifact. It is a delivery-contract result: an isolated worker with no commit is
not considered delivered. The existing Swarm contract deliberately keeps that worker in `need_review` rather than
claiming that a branch was collected.

The run therefore does **not** justify adding a fallback or weakening the gate. It does identify a product contract
boundary that must remain explicit:

1. A write-oriented isolated worker must create a commit, and its parent must collect it before the run can be
   successful.
2. A read-only/research worker is a different contract. If that role is intended, the protocol needs an explicit
   result kind; silently treating a no-commit isolated worker as delivered would be incorrect.

### Forced Swarm, adopted consumer, write-oriented collection

The same fixture was then run as a write task. Three isolated workers committed concrete artifacts: a binary
carver (`18a1794`), a SQLite rebuild/query path (`ef2eaf1`), and an independent verifier (`568aff8`). The parent
collected them with `cherry-pick -x`, regenerated the final artifacts in the main workspace, and produced commit
`6544ce2`.

Independent verification passed:

- `recover.json`: 8/8 known rows, plus 2 extra rows, exact `{word, number}` shape;
- binary carve, SQL query on a repaired database, and an independent `sqlite3` query all returned the same 10 rows;
- `PRAGMA integrity_check` returned `ok`; the input database hash was unchanged; the main worktree was clean.

The durable state exposed the important boundary. The protocol had three topology edges and 9/9 messages dequeued,
but after the parent resolved an add/add `recover.json` conflict and regenerated outputs, `git cherry` reported
`-` only for the carver and `+` for the rebuilder and verifier. The database therefore still showed all three
children as `need_review` / `awaiting` with `merge` proposals, and the parent as `active`, even though the useful
code and final artifact were present in the main workspace.

This is not message loss. It is a delivery projection mismatch: semantic collection after conflict resolution is
broader than the current patch-equivalence receipt. The current contract is conservatively correct not to mark those
workers `merged`, but it cannot express “the useful portions were collected and the conflicting artifact was
reconciled.” That is the next correctness decision, not a reason to add a fallback.

### Existing layered product run

An earlier real recursive run produced the topology `parent -> alpha -> beta`. The parent and both child records were
durable, six protocol messages were dequeued, alpha's branch was collected and marked `merged`, and beta remained
`need_review` with a merge proposal. This is the expected state when the second worker has work awaiting collection;
it is not evidence that the hierarchy or mailbox failed.

## Current conclusion

The tested protocol behavior is coherent: no message loss, no phantom topology edge, and no false `merged` state.
The strongest product signal is now narrower: after a real write task succeeds and conflict resolution changes the
patch shape, session state stays open instead of silently claiming delivery. That is a correct conservative result,
but it leaves a real user-visible task unfinished in the session ledger.

Before changing session-core, the contract must choose one of two explicit semantics: require conflict-free
artifact ownership so patch-equivalent collection remains the only receipt, or add a first-class reconciliation
receipt that records the parent commit and the worker commits it subsumes. The benchmark already proves why a silent
fallback or a blind `merged` write would be wrong.
