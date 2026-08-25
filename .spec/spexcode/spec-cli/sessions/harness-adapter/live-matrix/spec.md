---
title: live-matrix
status: active
hue: 280
desc: The parameterized harness conformance scenario suite — eight live behaviors exercised by a test file against any registered launcher, filing per-scenario eval readings on that harness's node.
code:
  - spec-cli/scenarios/harness-live-matrix.ts
related:
  - spec-eval/src/filing.ts
  - spec-eval/src/scenarios.ts
  - spec-cli/src/harness.ts
---

# live-matrix

[[harness-adapter]]'s acceptance rule — an adapter merges only with per-behavior readings measured through
a REAL dispatched session — used to live as prose: each harness's eval.md hand-transcribed its own wording
of the eight behaviors and a worker ran them by hand, so every new harness re-copied the matrix or silently
dropped rows. This node keeps that coverage as a parameterized test asset: the behavior contracts live in each
harness's `eval.md` scenarios, while one test file supplies the shared drive and evidence collection. Running
the test against a launcher is a test action, not a new SpexCode CLI verb.

Each scenario carries its contract in `eval.md` and points at the test case that supplies the DRIVE (real
steps over the public session verbs — new/send/show/stop/resume/close, plus a materialize for the transient
guard hook and tmux for the liveness kill; never a parallel mechanism). The test captures EVIDENCE as a
per-scenario transcript of every command, board observation, and pane capture, then files it with the
reading. `spec-cli/scenarios/harness-live-matrix.ts` resolves the launcher to its harness, targets the
`<harness>-harness` spec node (`--node` overrides), and walks ONE real worker through the whole lifecycle:
undeclared-stop · pretooluse-block · ask-note · deliver-steer · resume · liveness · commit-gate ·
close-residue.

The scenario declaration is the contract source: the test resolves the existing canonical name or historical
alias and fails loudly when the harness node has not declared it. It never creates or rewrites `eval.md`.
Adding coverage means adding scenario data and, where needed, a parameterized test case; it does not widen the
CLI or add a harness-specific route.

A harness whose declared runtime semantics intentionally remove a matrix premise does not fake the row.
[[claude-headless]] is record-backed and has ephemeral turn children, so `stop -> offline -> resume` and
`SIGKILL -> offline` are categorically the wrong measurements; its own idle-resume and record-liveness scenarios
replace those two rows while the remaining shared behaviors and its interrupt addition stay live behavior
readings.

Verdicts stay honest three ways: a row that could not be provoked (the worker declared on its own; no
mid-turn window opened) files NOTHING and reports skip — never a fabricated loss signal; a measured row
files pass or fail immediately, so an aborted run keeps its partial readings; and the runner's own board
polling is exactly the probe pressure the delivery path must survive, so the measurement environment is the
adversarial one. A new harness is covered by registering its launcher and adding its scenario data — zero new
CLI code.

## the acceptance contract this suite measures

An adapter is accepted by LIVE BEHAVIOR, never by artifact inspection: pi's stop-gate bridge shipped with
every mechanical proof green (shim written, manifest compiled, unit tests passing) while a real session
silently dropped every stop-gate rejection and hung `active` forever. So a new or reworked adapter with a
resident or controller-backed runtime merges only with per-behavior eval readings, each measured through a
REAL dispatched session of that harness, covering eight lifecycle behaviors: (1) **undeclared stop** — the gate's rejection reaches the
session and the record flows out of `active`; (2) **PreToolUse block** — a blocking hook genuinely stops
the tool and the handler's own reason reaches the agent; (3) **ask** — `spex session ask --note` flips the
record to `asking` with the note on the board. Its worker-facing declaration handler is
`session-declarations.ts#runSessionDeclaration`, while the shared record writer remains lower-level state
mechanics; (4) **deliver + steer** — an idle send lands exactly once
(exit 0) and a mid-turn send reaches the live turn; (5) **resume** — stop → resume continues the SAME
conversation; (6) **liveness** — a killed agent reads `offline` within seconds (even with a stale socket
file on disk) and a relaunch reads `online`; (7) **commit gate** — a dirty-tree merge proposal is rejected
at settle with the reason delivered into the session; (8) **close** — zero residue (tmux window, process
tree, worktree/branch, sockets, session record). The matrix is a parameterized test asset in [[live-matrix]],
while each harness node's `eval.md` owns the scenario declarations. The test file drives a real dispatched
session of any registered launcher through the declared behaviors and files per-scenario readings with
evidence transcripts; it never mutates the CLI or rewrites the declarations. A new harness is covered by its
launcher + scenario data, with no new runner route. A harness whose evidence is only artifacts has not been
measured. The shared matrix applies where the behavior has the shared process-resident meaning; a deliberate
semantic difference is measured by a replacement scenario rather than forced into a false common shape.
[[claude-headless]] replaces the matrix's TUI rows with its own session-home idle-resume, cold-retirement, and
hard-interrupt readings. [[codex-headless]] replaces
the matrix's process-resident stop/resume and kill/offline rows with its no-TUI idle-turn and record-liveness
readings, while delivery remains the shared app-server `turn/start`/`turn/steer` path. [[pi-headless]] replaces
the TUI rows with session-home liveness plus pi's text-mode rendezvous-steer/cold-resume and cold-retirement readings.
[[zcode-harness]] is a deliberate one-shot exception: its `--prompt` launcher has no reusable control
channel, so its replacement scenario measures launch prompt receipt, hook gates, declaration, and process
liveness. `deliver` and `resume` explicitly reject rather than impersonating a control transport; no false
combination cell is filed for an operation that harness does not offer.

Prompt delivery also carries a dense, rerunnable COMBINATION campaign across every registered adapter that
declares a delivery path (currently four interactive and four controller-backed headless adapters, including [[codex-headless]]): harness form x prompt origin (launch's first prompt, the terminal-free input route with
`replyVia:"note"`, and plain `spex session send`) x delivery timing (idle wake and in-turn steer/queue). Each
runnable cell uses only those real product surfaces and proves four facts together: native delivery confirmed,
the answer is readable at the requested/available user surface (`replyVia:"note"` and every headless default
land in a timeline declaration note; an interactive plain launch/send lands in its pane), liveness stays
truthful, and the authored declaration lands. A pane reading includes its real tmux scrollback: stop-gate
guidance may scroll a valid answer above the current viewport, which is still user-readable pane output, not
a missing response. Declaration landing is proven by the live board's observed `active -> settled` transition;
it does not require a matching history row because the debounced timeline observer can legitimately fold a fast
turn that returns to the same status between samples. That board proof never substitutes for a required timeline
ANSWER: a note-routed cell still waits for the marker in `/timeline`. The launch prompt has no second in-turn invocation, so
`launch x in-turn` is an explicit BLOCKED cell rather than a fabricated send path.
The note insert treats the declaration command as reply TRANSPORT, not as part of the requested work: even a raw prompt that
says "use no tools" or "only print the answer" must still finish by placing the complete reply in the truthful declaration's
`--note`. Normal final output is invisible on this route, and the stop-gate's generic auto-declaration is lifecycle recovery,
never an answer substitute.
BLOCKED is reserved for that structural non-cell: a runnable cell whose turn cannot start, exits without a
reply/declaration, or leaves a stale lifecycle is a FAIL (with any matching issue referenced), and the runner
still invokes later cells through the real adapter instead of converting one failure into skipped coverage.
Every cell files its own transcript-backed reading on the most specific adapter node available; the aggregate
table files on this node. The campaign reuses one session per launcher to keep model spend bounded while still
preserving real note-to-terminal channel transitions, and gives pi-family turns a wider first-token wall.
