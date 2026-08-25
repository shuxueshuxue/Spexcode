---
title: identity-injection
status: active
hue: 280
desc: SPEXCODE_SESSION_ID is injected where it is known and never inferred later — every process SpexCode creates gets its own governed id or none, and the commit trailer reads that variable and nothing else.
code:
  - spec-cli/templates/hooks/prepare-commit-msg
related:
  - packages/spec-core/src/harness-identity.ts
  - spec-cli/src/session-stamp.test.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/harness.ts
---

# identity-injection

One invariant gives `SPEXCODE_SESSION_ID` its meaning across [[harness-adapter]]'s launches, the Codex shared
app-server, and the git trailer: identity is handed to a process at the moment it is created, by whoever knows it,
and nothing downstream re-derives, checks, or guesses it.

**Identity is INJECTED where it is known, never inferred later.** `SPEXCODE_SESSION_ID` names the governed
record of the context it sits in, and it earns that meaning from ONE invariant: every process we create is
given its own identity, and a process that belongs to no single session is given none.

- A **session launch** bakes `SPEXCODE_SESSION_ID=<record id>` into the agent — after STRIPPING every
  session-identity variable it inherited (`sessionIdentityEnvVars()`, adapter-derived: the launch-injected id
  plus each adapter's `sessionEnvVar`). The strip is not decoration: a session's pane inherits the tmux
  SERVER's environment, so without it whichever session started that server rides along into every later
  worker.
- A **codex thread** cannot be handed identity that way — its tool shells are children of the SHARED
  app-server, not of its own agent — so the backend injects the same variable per THREAD, through codex's own
  `shell_environment_policy.set` in `thread/start`'s config override map (`codexStartThreadParams`), and the
  visible `--remote … resume` TUI re-establishes it with the same `-c` override, because that client is the
  other entry point creating a context for this session. Verified live: the thread's own tool shell reports
  exactly the injected record id and nothing of the launcher's environment.
- The **shared app-server** — and any other process we own that serves every session rather than one — is
  spawned with those variables stripped. This is the same invariant read from the other side, and it is where
  github#76 came from: a daemon started by one session outlived it and kept handing that session's id to every
  later thread's `git commit`, so commits carried a stranger's session and, once it closed and its record was
  swept, an id that named nothing.

So identity is not something later code re-derives, checks, or guesses at. `prepare-commit-msg` READS
`SPEXCODE_SESSION_ID` and stamps it: no store lookup, no per-harness ladder, no ancestry test, and nothing
taken from the current directory — where a process stands says nothing about who it is, and a trailer written
from a guess is worse than an absent one. No id → no trailer. The same invariant is what lets `envSessionId`
([[portable-layout]]) and `hp_session_id` keep the alias step as a NARROW concern (a hook payload carries the
acting codex THREAD id, which is a harness identifier rather than a record key) instead of a defence against a
contaminated environment.

A missing id is the ORDINARY case — most repos on the box are nobody's session — so the hook no-ops cleanly
under `set -euo pipefail` rather than aborting the hook and the commit with it; the fail-loud stance is
reserved for genuine errors past that point. The stamp lands via `git
interpret-trailers`, never a raw append: git parses only the LAST paragraph as trailers, so an appended
`Session:` paragraph would silently demote any trailer block the message already carries (e.g. `spex ack`'s
`Spec-OK:`) to body prose; interpret-trailers joins the existing block instead.
