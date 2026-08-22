# SlopCodeBench Two-Problem Behavior Study

This study measures a real ZCode session under iterative specification growth. It uses exactly two official
SlopCodeBench problems and does not feed evaluator failures, hidden tests, reference solutions, or future checkpoints
back to the model.

## Inputs

- Runner: [SprocketLab/slop-code-bench](https://github.com/SprocketLab/slop-code-bench) at
  `06b5c0687d4c05ee502e9696a4d0c22fc1eec5e0`.
- Problems: [gabeorlanski/scb-problems](https://github.com/gabeorlanski/scb-problems) at
  `ef6a9dd13911566b6b01075ca121758c9f7b5c5f`.
- Product: z-code proposal `d97c3e87e1784e306a3cbde4020d65fa73ac8a00`, compiled `zcode` CLI, real
  `bigmodel/glm-5.3` provider responses, `ZCODE_FEATURE_SWARM=1`.
- Problems: `file_backup` (four checkpoints) and `code_search` (five checkpoints).
- User instruction around each official checkpoint: implement or continue the checkpoint in this repository; do not
  inspect files outside it. No decomposition plan, test hints, dependency hints, or forced Swarm instruction was added.

The official runner was calibrated before measuring the product. Its checkpoint-1 reference snapshot for
`file_backup` passed 32/32 tests in the same Docker evaluator
(`evaluation.json` SHA-256 `a7adcf2f65536d4644c219f61223af3d93e2a3783e348e3249e2148a5306fea3`).

## Isolation

Each problem used a different subroot under one random experiment root, Git repository, `ZCODE_STORAGE_DIR`,
main-session identifier, snapshot tree, evaluator-output tree, and temporary directory. The two model rollout logs
contain no reference to the other problem's workspace. Only the current checkpoint text was supplied to the model.
Tests and solutions remained outside both agent repositories.

Every checkpoint was frozen as a Git snapshot before the next checkpoint began. The official evaluator then mounted
that snapshot into a short-lived Docker container using the official Python 3.12 environment. Evaluation was never
run against a workspace while the agent was writing it.

The isolation has one measured limit. `file_backup` created 126 test-fixture files under the host-global
`/tmp/bstest` despite the repository-only instruction. They were preserved under that problem's experiment root and
removed from the shared name before `code_search` started. `code_search` received a separate `TMPDIR`, but prompt text
and `TMPDIR` are not an operating-system sandbox. No claim of full filesystem confinement is made.

## Results

### `file_backup`

One durable session (`sess_b2b1772c-eaf7-49f9-912d-fa14e2517124`) implemented all four specifications. It used no
Swarm children. Each turn returned a normal provider `stop`, edited the same repository, and exited zero.

| checkpoint | snapshot commit | official result | evaluator exit |
| --- | --- | ---: | ---: |
| 1 | `a24e9e0` | 4/32 | 1 |
| 2 | `d36cabf` | 4/50 | 1 |
| 3 | `5db951f` | 5/68 | 1 |
| 4 | `4f60527` | 5/89 | 1 |

The implementation imported PyYAML after observing that it existed on the host, but never delivered
`requirements.txt`. In the clean evaluator, all functional paths failed at `ModuleNotFoundError: yaml`. The four
checkpoint-1 error tests passed only because the same earlier import failure produced a nonzero result; they do not
establish schema correctness. Checkpoints 3 and 4 gained one genuine pass for rejecting a missing destination, but
the dependency failure still prevented every successful execution path.

This is a reproducible-delivery failure, not a session-message or topology failure. It proves that host self-tests do
not establish that the delivered snapshot is runnable.

### `code_search`

One durable session (`sess_98b35915-0593-456f-ab1c-c2a324ae31c0`) handled all five specifications. It also used no
Swarm children. The first two checkpoints were implemented and preserved all earlier tests.

| checkpoint | snapshot commit | turn result | official result | evaluator exit |
| --- | --- | --- | ---: | ---: |
| 1 | `17c6b36` | normal `stop` | 13/13 | 0 |
| 2 | `204ae1c` | normal `stop` | 25/25 | 0 |
| 3 | `8beac07` | `length`, empty no-op | 25/47 | 1 |
| 4 | `21befb8` | `length`, empty no-op | 26/75 | 1 |
| 5 | `9c12217` | `length`, empty no-op | 26/104 | 1 |

The last three turns have the same machine shape:

| checkpoint | provider input tokens | provider output tokens | tool calls | response bytes | CLI exit | projected status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 3 | 37,623 | 32,000 | 0 | 0 | 0 | `idle` |
| 4 | 39,713 | 32,000 | 0 | 0 | 0 | `idle` |
| 5 | 41,295 | 32,000 | 0 | 0 | 0 | `idle` |

The rollout records provider `finishReason=length` for each turn. ZCode nevertheless returned an empty JSON response,
process exit zero, and an idle session projection. No tracked file changed. The empty checkpoint commits in the table
make that absence reviewable; they are not presented as implementation commits.

The official results confirm the effect boundary. At checkpoint 3, all 25 prior tests still passed and all 22 new
pattern/capture tests failed. Checkpoints 4 and 5 continued to run the unchanged checkpoint-2 implementation; 26 tests
passed only because the 25 earlier behaviors remained valid and the old CLI already rejected mutually exclusive fix
flags. No hidden implementation was lost during snapshot collection.

## Correctness Finding

The primary session-core finding is not that a model can hit its token limit. The incorrect behavior is the mapping:

```text
provider finishReason=length
  + empty assistant response
  + zero tool effects
  -> process exit 0
  -> session status idle
```

That mapping converts an incomplete turn into a successful one, allowing an orchestrator or user to advance while no
work occurred. It reproduced in three consecutive checkpoints.

The required correction is narrow: a token-limit termination is an incomplete turn and must be observable as a
non-successful process/session outcome. The product should preserve the provider reason and the durable session so the
user can decide what to do next. This benchmark does not justify an automatic retry, silent compaction, alternate
model, fabricated assistant message, or success fallback.

Two secondary findings belong outside session core:

1. Reproducible delivery needs an adopter or task-completion gate that runs the delivered snapshot in a clean
   environment. Seeing a dependency on the host is not a package declaration.
2. Filesystem isolation must be enforced by the launcher/process boundary. A prompt and `TMPDIR` cannot prove that an
   agent stayed inside its repository.

## Evidence Digest

The report retains compact evidence rather than raw model or terminal dumps. Official evaluator JSON SHA-256 values:

| problem | checkpoint hashes in order |
| --- | --- |
| `file_backup` | `c6b7718d...`, `5e068850...`, `478ebbbf...`, `5f303430...` |
| `code_search` | `9d7168e2...`, `c6d51a90...`, `0967db8d...`, `ac137909...`, `994622d0...` |

Both experiment repositories were clean except for `code_search/__pycache__`, an untracked runtime byproduct excluded
from the frozen Git snapshots. There were no cross-workspace references in either model rollout, and each problem had
exactly one durable main-session rollout file.
