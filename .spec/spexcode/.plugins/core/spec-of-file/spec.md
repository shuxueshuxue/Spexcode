---
title: spec-of-file
surface: hook
status: active
hue: 200
desc: A per-edit annotation that never renders a verdict: the first edit of a file tells an uncovered one to find a spec home, and names the governor of a covered one.
events:
- PostToolUse
order: 10
block: false
---
The startup `SPEX_PROFILE` hook list may disable this repository-facing annotation with a clean no-op; `full` and profiles that include `spec-of-file` retain it.
A non-blocking per-edit annotation that speaks only when there is something to act on. The first time a session edits a given file, an uncovered file is told to get a spec home before it drifts, and an over-owned one is told it is doing too much and pointed at the split; a sanely-owned file draws silence. The point is to put the contract in view at the very moment of the edit, not only later at commit or drift time.

It never renders a verdict: it only adds context, so it can inform without interrupting. Like [[spec-first]], spec-awareness is universal — it is NOT gated on `governed` and runs for any agent. It is deduplicated once per normalized repo-relative file via a ledger that lives as a sibling file in the session's global store dir (keyed by the payload's `session_id`), so a fifty-edit refactor annotates each file once rather than on every write — the discipline that keeps a pervasive signal from decaying into the noise it is meant to cure. It only speaks for Git-relevant files inside the current repo: tracked files, plus new untracked files that are not ignored. Paths outside the repo, `.spec`, `.git`, and ignored artifacts stay silent.

This is the at-the-keystroke companion to the read-first gate [[spec-first]] and the commit-time checks: together they keep the [[core]] rule — code must not silently diverge from its spec — visible across the whole edit loop.
