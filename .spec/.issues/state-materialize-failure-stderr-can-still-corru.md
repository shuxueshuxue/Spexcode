---
concern: [[state]] materialize failure stderr can still corrupt the governed session record
by: 58195f32-61b8-4e69-9b91-b41fc2594501
status: open
nodes: state
created: 2026-07-29T02:09:10.050Z
---

A real concurrent public session-new produced a materialize failure containing a shell command with double quotes. The creation response was initially structured, but the failure-note update wrote the stderr into session.json without JSON escaping; the note line broke at "$0", the record became corrupt/unknown, public close could no longer prove ownership, and the already-started Codex leaf/thread survived until exact operator cleanup.

[[state]] needs one JSON-safe record mutation boundary for every note/status/proposal writer, including create/materialize failure recovery. No path may interpolate raw hook, git, launcher, or tool stderr into the one-field-per-line JSON record. A deterministic positive control must inject quotes, backslashes, newlines and non-ASCII into the materialize failure, then prove session list/show/stop/close remain readable and byte-valid; a concurrent config-lock YATU must leave either one clean failure record or no record, never a corrupt active row.
