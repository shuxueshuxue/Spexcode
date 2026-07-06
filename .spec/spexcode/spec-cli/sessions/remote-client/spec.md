---
title: remote-client
status: active
hue: 280
desc: The CLI's read/control commands are thin BACKEND CLIENTS, so one install monitors any machine's sessions.
code:
  - spec-cli/src/client.ts
---

# remote-client

## raw source

A session's live state lives where its tmux and worktrees are — on the backend's machine. So the `spex` CLI
must not read or drive sessions in its own process: a manager on one machine should monitor and drive an
agent on another, and there must be exactly **one** actor on a given tmux socket. The CLI's **read and
control** verbs are therefore thin clients of the running backend, the same way the dashboard is — the
backend is the single broker, and which machine you point at is just a URL.

## expanded spec

The read/control commands — `ls`, `watch`, `wait`, `capture`, `send`, `rename`, `rawkey`, `review`, `merge`,
`reopen`, `exit`, `close`, `prompt` — call the backend over HTTP (`SPEXCODE_API_URL`, else the local default).
(`session attach` is the ONE deliberate exception — a foreground terminal can't be brokered over HTTP, so it
stays local and guards that premise loudly; see [[session-attach]].) They hold **no**
in-process tmux/git path, so the backend is the **single actor** on the tmux socket and the single source of
derived state, and pointing `SPEXCODE_API_URL` at another machine's backend monitors and drives THAT
machine's sessions with no code change — the dashboard's viewer-points-anywhere model, extended to the CLI.
`watch`/`wait` take the board **source** as a required argument (the backend client), so a poll can never
silently read a local board by default.

**Every command speaks the same selector grammar.** A caller names a session by full id, id-prefix, node, or
branch — and not just the list verbs: the **control** verbs accept it too. The backend matches `/…/:id`
EXACTLY, so `resolveClientSession` resolves a selector against the live board (the [[session-selectors]]
matcher over `clientListSessions`) and the verb then calls with the resolved FULL id. A non-match is loud and
precise — `none` → no such session, `ambiguous` → the candidate ids — never a silent miss against the backend.

The split is load-bearing and is the whole point. State **producers** stay **local**: `done`/`ask`/`park`/
`idle` and the lifecycle hooks write the agent's OWN per-session record in the GLOBAL store directly (keyed
by session_id — see [[state]]), so an agent must be able to declare its own state even with no backend up. The
backend learns that state by ENUMERATING the store, not by a write of its own. **Launch**
(`spex new`) keeps its own already-justified path (it needs the backend's auth env — see [[launch]]). Only
the verbs that observe or drive live tmux route here.

**One availability rule, FAIL LOUD.** Unlike a best-effort telemetry POST, an unreachable backend throws a
clear `no backend reachable at <url>` and a non-zero exit — never a silent fall back to a local in-process
path, because that fallback is exactly what would re-create two actors on one tmux socket. `watch` warns once
and keeps streaming (a backend blip must not read as "all sessions fine"); `wait` fails loud rather than
reporting a false timeout.

**Failure stays distinct from emptiness.** A monitoring read must let a manager tell "I couldn't read" from
"the screen is blank": `capture` returns a genuinely empty pane as success, but maps unknown-session,
offline (no live pane), and a capture error to distinct non-zero outcomes — a blank screen that exits 0 is
never confused with a read that failed.

**Parity with the dashboard's session gestures.** Anything a human can do to a session by pointing at the
board, an agent manager must be able to do by typing — the backend endpoint already exists in each case, so
the CLI's job is only the thin verb over it. `rename` is the right-click rename ([[session-rename]]) as a
verb: it sets the display-name override (an explicit `""` clears it back to the derived label; a *missing*
argument is a usage error, never a silent clear), and an unknown session exits non-zero off the endpoint's
404. `rawkey` is nav mode as a verb — the raw `tmux send-keys` channel (never the prompt socket), which is
how a manager un-wedges a worker stuck in an interactive TUI dialog the prompt channel cannot drive (a
select menu wanting one Enter or arrow). It takes whitespace-separated key tokens in the frontend's own
vocabulary (named keys, single printable chars, `C-`/`M-`/`S-` combos), delivered as ONE ordered batch so
strike order survives ([[nav-mode-key-ordering]]); nothing-delivered (unknown session, no live pane, or no
valid token) exits non-zero — a dead keystroke never reads as a pressed one.
