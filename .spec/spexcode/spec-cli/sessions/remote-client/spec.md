---
title: remote-client
status: active
hue: 280
desc: Every session verb asks what the backend IS for it — owner, cache, or remote transport — and that answer alone decides whether a missing backend is fatal.
code:
  - spec-cli/src/client.ts
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/supervise.ts
---

# remote-client

## raw source

"Does this command need the backend?" was answered twice, from two different questions, and the two answers
disagree: `session new` — the verb that launches a process — falls back to running in-process when it can
*prove* nothing is listening, while `session ls` — a read that changes nothing — fails outright. The
inversion is the tell that the line was never drawn once. Draw it once, by asking of each verb what the
backend actually **is** for it. There are only three answers, and each dictates its own behaviour when no
backend answers.

## expanded spec

**Three roles, one question per verb.**

- **Owner** — doing it twice is destructive, and it needs a resource only an owner may hold: `new`, `resume`,
  `stop`, `close`, `archive`, `quarantine`, `interrupt`, `merge`, and the poke half of `send`. These prefer
  the running backend, which holds the launch environment and the concurrency cap. They may act in-process
  **only after proving there is no owner** — an explicit `ECONNREFUSED`; any HTTP answer, including `404`
  and `503`, proves a backend owns the target, and an indeterminate outcome fails loud rather than risking
  two actors ([[session-new]] states this rule for launch; it is the general one).
- **Cache** — the answer is a pure function of durable state and the backend merely has it warm and shared:
  `ls`, `show`, `review`, `resources`, and the log-following of [[session-follow]]. With no backend
  resolvable these read locally and **name their source**, because a read holds nothing and races nothing.
  What degrades is only the derived half: liveness needs a probe an unowned reader must not run, so it
  reports `unknown` — the same honest value a failed probe yields, and one that already withholds every
  action that would need death to be proven ([[state]]).
- **Remote transport** — the state is physically on another machine. An explicit `--api`/`--port` naming a
  remote endpoint has no local answer, so an unreachable backend is a genuine, loud failure. Nothing is
  faked and nothing falls back.

The split is not "reads versus writes" but "what would be wrong if two processes did it": exclusion is
enforced by the per-session record lock, not by the identity of the process holding it ([[layers]]). The
backend is therefore the convenient owner of launch and the shared cache — never the holder of the
invariant. (`session attach` remains its own case: a foreground terminal cannot be brokered over HTTP, so
it stays local and guards that premise loudly against the resolved backend; see [[session-attach]].)

Pointing `--api` (or `SPEXCODE_API_URL`) at another machine's backend still monitors and drives THAT
machine's sessions with no code change — the dashboard's viewer-points-anywhere model, extended to the CLI.
A local fallback never silently impersonates it: the source is stated on every read that took one.

**Which backend — the ladder, flag-first.** One host runs many projects' backends, and a shell inherits the
launching backend's `SPEXCODE_API_URL` — an env var cannot prove intent (exported-on-this-command and
inherited look identical), which is exactly the misroute: every bare `spex` in a second project's tree
silently drives the first project's backend. So the endpoint resolves once per process, keeping its source:
(1) an explicit **`--api <url>`** (`--port <n>` as localhost sugar) — the only provably deliberate signal —
always wins; (2a) a **worker** (backend-injected `SPEXCODE_SESSION_ID`) trusts its env `SPEXCODE_API_URL`,
the deterministic lifeline its state writes ride, never stolen by discovery; (2b) a **human** shell prefers
the cwd project's **recorded live backend** (`spex serve` records it at bind time; the reader health-probes
first, so a dead record is ignored, never followed); (3) each side falls back to the other; (4) the local
default. A malformed `--api`/`--port` fails loud as usage, never a silent default.

**Writes are project-bound; reads point anywhere.** A URL carries no project identity, so a misresolved
endpoint turns a state write into a wrong-repo mutation. Every MUTATING verb — `new`, `merge`, `send`, `interrupt`,
`close`, `quarantine`, `rename`, `rawkey`, `reopen`, `exit` — therefore compares the caller's repo root to the backend's
served root before writing and REFUSES loudly on a provable same-host mismatch, naming both identities and
the explicit-routing remedy. An explicit `--api`/`--port` skips the guard (the flag IS the proof of intent);
no local repo, an unreachable backend, or a genuinely remote root fall through to allow. Reads stay unguarded.

**Every command speaks the same selector grammar.** A caller names a session by full id, id-prefix, node,
branch, or `.` for the session owning the caller's current worktree (with the launched own-session id as the
other exact anchor) — and not just the list verbs: the **control** verbs
accept it too. The backend matches `/…/:id`
EXACTLY, so `resolveClientSession` resolves a selector against the live board (the [[session-selectors]]
matcher over `clientListSessions`) and the verb then calls with the resolved FULL id. A non-match is loud and
precise — `none` → no such session, `ambiguous` → the candidate ids — never a silent miss against the backend.
The one necessary integrity exception is `session quarantine <exact-id> --restore`: quarantine deliberately
removed its row from the live board, so a selector has nothing honest to resolve; restore therefore requires
the original exact id and calls the same backend rather than falling back to local storage.

State **producers** were always local and stay that way: `done`/`ask`/`park`/`idle` and the lifecycle hooks
write the agent's OWN per-session record in the GLOBAL store directly (keyed by session_id — see
[[state]]), so an agent declares its own state with no backend up. The backend learns that state by
ENUMERATING the store, never by a write of its own — which is the same fact the Cache role above
generalises to every read.

**Degradation is never silent, and never invented.** An Owner verb that cannot prove the absence of an owner
throws a clear `no backend reachable at <url>` with a non-zero exit. A Cache verb that fell back says which
source it read, on stderr, every time. A Remote-transport verb fails loud. What no verb ever does is answer
from a different source while claiming the one it was asked for.

**Failure stays distinct from emptiness.** A monitoring read must let a manager tell "I couldn't read" from
"the screen is blank": `show --capture` returns a genuinely empty pane as success, but maps unknown-session,
offline (no live pane), and a capture error to distinct non-zero outcomes — a blank screen that exits 0 is
never confused with a read that failed.

**Parity with the dashboard's session gestures.** Anything a human can do to a session by pointing at the
board, an agent manager must be able to do by typing — the backend endpoint already exists in each case, so
the CLI's job is only the thin verb over it. `rename` is the right-click rename ([[session-rename]]) as a
verb: it sets the display-name override (an explicit `""` clears it back to the derived label; a *missing*
argument is a usage error, never a silent clear), and an unknown session exits non-zero off the endpoint's
404. `send --keys` is the last-resort raw `tmux send-keys` channel (never the prompt socket), which
is how a manager un-wedges a worker stuck in an interactive TUI dialog the prompt channel cannot drive (a
select menu wanting one Enter or arrow), and the **last resort** every surface teaching it marks it as: try a
plain `send` text first. It takes whitespace-separated key tokens in the frontend's own
vocabulary (named keys, single printable chars, `C-`/`M-`/`S-` combos), delivered as ONE ordered batch so
strike order survives ([[nav-mode-key-ordering]]); nothing-delivered (unknown session, no live pane, or no
valid token) exits non-zero — a dead keystroke never reads as a pressed one.
