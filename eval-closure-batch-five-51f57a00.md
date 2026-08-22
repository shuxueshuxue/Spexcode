# Eval closure batch five

Session: `51f57a00`

Measured code: `5d75316def6b110d8d359f8273e76da00c65c6ea` (the requested parent
HEAD). Every product run used `/home/jeffry/.nvm/versions/node/v22.21.0/bin/node`
(`v22.21.0`) and npm `10.9.4`, with an isolated temporary `SPEXCODE_HOME`,
unique backend port, and unique tmux/backend runtime. Raw transcripts remain
outside the repository under `/tmp/eval-batch-five-*.txt` and were filed only
after each reading passed.

## Readings

| scenario | real surface | verdict | evidence |
| --- | --- | --- | --- |
| `session-fail/machine-turn-failure-is-one-active-only-cas` | Isolated live backend; governed records created through `POST /api/sessions`; shipped Claude `spex internal session-fail --session`; headless `spex internal session-turn-fail`; verification through `GET /api/sessions/:id` | PASS; filed with `spex eval add session-fail --scenario machine-turn-failure-is-one-active-only-cas` | `/tmp/eval-batch-five-machine-final-1787383970.txt` |
| `sessions/launch-node-binding` | Isolated live backend; real create API, graph API, generated global `launch.sh`, and explicit stale `node` rejection | PASS; filed with `spex eval add sessions --scenario launch-node-binding` | `/tmp/eval-batch-five-launch-final3-1787384106.txt` |
| `state/explicit-stop-is-authoritative-offline` | Isolated live backend with pane-backed fake Claude and `pi-headless`; public stop/resume routes, CLI state/send, session detail and timeline reads | PASS; filed with `spex eval add state --scenario explicit-stop-is-authoritative-offline` | `/tmp/eval-batch-five-stop-final-1787384189.txt` |

## Outcome details

- The failure CAS changed only an undeclared live `active` record to `error`.
  Authored `awaiting`/`merge` and explicit stopped/offline records retained
  their lifecycle, proposal, and notes; both failure writers returned a
  no-op for those non-active records.
- Launch binding rejected an explicit `node` field with HTTP 400 and no
  session. The first prompt mention bound ASCII, CJK, `.plugins`, and missing
  IDs in both the record and graph with the expected slug; no mention was the
  only unbound case. The existing `alpha` node produced a launch spec pointer.
- Stop made both the pane and headless sessions offline. Resume restored them
  online without changing lifecycle, proposal, note, or timeline; the
  headless follow-up used the same native session id and reached its post-resume
  declaration note.

## Setup and invalid attempts

- The first machine probe was rejected before product setup because its
  temporary project had no Git repository. It returned the backend's explicit
  `session_create_failed`/`not a git repository` response and is setup failure,
  not a product verdict. The corrected run initialized and committed the
  fixture before measuring.
- Two early launch probes sampled `/api/graph` before its session row was
  observable and stopped in the probe assertion. They were discarded as
  harness timing/setup attempts; the final run polled the real graph surface
  before asserting and passed all cases.

No product code or scenario prose was changed. The session-fail eval code
locator was minimally repaired from an unparseable source symbol to its
parseable owning product test path, as recorded above; no acknowledgement or
acceptance/review artifact was changed.

## Verification

`spex spec lint` completed with 0 errors (21 existing warnings). The
session-fail eval row uses the parseable owning product test path
`spec-cli/src/sessions.test.ts` instead of the parent source's unparseable
symbol anchor. After that eval-only row correction, `spex eval lint --changed`
reports 0 malformed rows; its remaining findings are unrelated stale
scenarios, which this batch did not acknowledge.
