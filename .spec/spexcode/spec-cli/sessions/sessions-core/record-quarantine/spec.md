---
title: record-quarantine
status: active
hue: 280
desc: The one recovery control for a governed record that cannot be parsed — it is neither close nor repair: the caller supplies the exact resources it extracted, the layer re-proves their absence, and only the record file moves.
code:
  - spec-cli/src/sessions.ts#quarantineCorruptRecord
  - spec-cli/src/sessions.ts#restoreQuarantinedRecord
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/harness.ts
  - spec-cli/src/session-record-integrity.test.ts
---

# record-quarantine

A corrupt record is a fact about a session that EXISTS ([[record-integrity]]), so every writer refuses on it and
`close` cannot prove its owners. That leaves one row nothing can retire — which is what this operation exists
for, and why it proves rather than guesses.

An unreadable governed record has one separate recovery control: **quarantine** is neither `close` nor a
repair. The caller supplies the exact former adapter/thread (or explicitly no native thread), tmux session,
worktree path, and branch it extracted from the opaque incident. The thread field is an adapter-native
conversation id, never the SpexCode session id: CLI omission explicitly sends no native thread, which is the
required witness for an adapter such as Claude that has none to archive. The shared layer then re-proves, at execution
time, that the session's registered leaf process is absent, that exact tmux session/worktree/branch are absent,
and that the named adapter is healthy. A named native thread must either be absent, or be an exactly-unowned,
idle, descendant-free native thread that its own adapter archives and re-censuses as unloaded; every live,
active, owned, ambiguous, descendant-bearing, changed-generation, malformed, or unknown control refuses before
the record moves. The operation never sends an OS signal, removes a worktree or branch, guesses an adapter, or
turns opaque bytes into a lifecycle record. On success it atomically moves only `runtime.json` out of the active
session directory to a per-project quarantine bundle, preserving its byte-exact payload plus the supplied claim
and the independently observed absence proof. The ordinary record enumeration then removes the corrupt row from
the session list, graph, and resource projection without a special hide list. `restore` is the explicit reverse:
it atomically moves the byte-identical record back only while no active record exists, making the corrupt row
visible again; it does not resurrect a runtime or infer lifecycle. CLI, HTTP, and the dashboard context control
all call this one operation and surface refusal details.
