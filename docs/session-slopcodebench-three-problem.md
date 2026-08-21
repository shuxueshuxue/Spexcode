# SlopCodeBench Three-Problem Follow-up

This is a follow-up to the two-problem behavior study. It uses three different official SlopCodeBench problems with
short instructions and one real ZCode session per problem. The model was not told to use Swarm, was not given hidden
tests or reference solutions, and was not retried after a turn failed to complete.

## Inputs and isolation

- Runner and problem catalog: the same pinned official repositories as the two-problem study.
- Product: z-code proposal `d97c3e87e1784e306a3cbde4020d65fa73ac8a00`, real compiled CLI and `bigmodel/glm-5.3`.
- Problems: `database_migration` (5 checkpoints), `dynamic_buffer` (4), and `dag_execution` (3).
- Each problem had its own random experiment subroot, Git repository, storage directory, session, `TMPDIR`, snapshots,
  and evaluator output. The next problem was not started until the previous product turn was stopped and its state
  retained. Later checkpoint text was never supplied before the corresponding turn.
- Every submitted snapshot came from a Git archive. No evaluator ran against a workspace while the model was writing.

## Product-side observations

### `database_migration`

Session `sess_56af2091-c480-43bb-b8ab-659a71e9e4e1`.

- Checkpoint 1: the model made two normal tool requests, then continued exploring; the workspace remained empty. The
  turn was cancelled after a ten-minute no-progress budget. The frozen snapshot was an empty repository.
- The official evaluator did run against that snapshot: **0/39**, exit 1, with no infrastructure failure.
- Checkpoint 2: the model eventually wrote `main.py` and a large `/tmp` test script, then the next test command never
  returned to the session. The turn was cancelled at the same bounded budget. No evaluator was run for this checkpoint.

The important observation is not that a model writes a large test. It is that a tool request can remain unresolved while
the durable session has no successful completion. The benchmark driver must retain that incomplete state instead of
letting a caller treat the process as a completed task.

### `dynamic_buffer`

Session `sess_f5fb1388-f413-4e29-9002-0fbc0df54e79`.

- The first model request produced no completed response, no tool call, and no workspace file during the bounded
  observation window. The turn was cancelled and the empty Git snapshot was retained.
- The official evaluator was deliberately **NOT-MEASURED**: the empty snapshot caused the Docker environment to wait
  on package setup before test collection. That infrastructure wait is not a product result.

### `dag_execution`

Session `sess_149dc0e4-ad6a-45a4-8dc5-d51015b18557`.

- The model issued two read-only tool calls, but neither tool result returned to the model. No source file was created.
  The turn was cancelled after the same bounded observation window and the empty snapshot was retained.
- The official evaluator was not run after the product-side cancellation; no score is claimed.

## What this adds to the correctness boundary

Across the three new tasks, the measured failure shape is broader than `finishReason=length`:

```text
tool call issued or provider turn started
  + no tool result / no assistant completion
  + no delivered workspace change
  -> bounded cancellation
```

This is an incomplete turn. It must remain observable as such in the durable session and must not become a successful
idle projection. The study does not justify retry, alternate model selection, silent compaction, or fabricated work.
The exact provider or tool-server cause is intentionally left open until a reproduction captures the lower-level error;
the correctness requirement is independent of that cause.

The `database_migration` clean-evaluator result also repeats the earlier delivery finding: host-side assumptions do not
prove that a frozen snapshot is runnable. The benchmark runner must keep product turn state and clean-snapshot
evaluation as separate evidence.

## Evidence boundary

The complete rollout JSONL and temporary evaluator logs stay under the random experiment root outside the repository.
This report stores only the session ids, snapshot identities, scores, and causal limits needed for review. No raw process
environment, remote-control dump, hidden test, or reference solution was copied into the product tree.
