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

## Runs

### Weak instruction, no forced Swarm

| task | product path | independent result | process |
| --- | --- | --- | --- |
| `sqlite-db-truncate` | one session directly recovered `recover.json` | 8/8 known rows | exit 0 |
| `deterministic-tarball` | one session wrote and committed `build.sh`; official verifier | 12/12 | exit 0 |

The parent did not invent a worker tree for either task. This is correct behavior: decomposition is not itself a
goal, and a single session can complete a task without creating unnecessary coordination state.

### Forced Swarm, adopted consumer, SQLite recovery

The same `sqlite-db-truncate` task was run in a consumer containing a real `spexcode.json`. The parent was required
to dispatch three isolated workers and then synthesize the result.

Observed facts:

- The final `recover.json` was correct (10 rows; the benchmark ceiling was reached).
- The protocol database contained one parent, three child sessions, and three parent-to-child topology edges.
- Nine protocol messages were persisted and all nine had a dequeue timestamp.
- The child worktrees remained isolated and contained their investigation artifacts.
- The parent and all three children were still represented in the durable database after the CLI process exited.
- Each child was `need_review` / `awaiting` with a `merge` proposal, because none had created a commit.
- The CLI exited with code 1 and reported `worker(s) were dispatched but committed nothing`.

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

### Existing layered product run

An earlier real recursive run produced the topology `parent -> alpha -> beta`. The parent and both child records were
durable, six protocol messages were dequeued, alpha's branch was collected and marked `merged`, and beta remained
`need_review` with a merge proposal. This is the expected state when the second worker has work awaiting collection;
it is not evidence that the hierarchy or mailbox failed.

## Current conclusion

The tested core behavior is coherent for the write-task contract: no message loss, no phantom topology edge, and no
false `merged` state. The strongest red signal is intentionally loud: the CLI refuses to return success while an
isolated worker's work has not been delivered.

The next correctness benchmark is a forced Swarm write task whose workers each commit a concrete artifact and whose
parent collects those commits. That run must prove the complete user story: worker commits, parent collection,
durable `merged` states, zero pending protocol messages, and verifier success. It is the required follow-up before
changing session-core or the Swarm state model.
