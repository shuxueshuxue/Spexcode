---
title: spec-of-file
surface: hook
status: active
hue: 200
events:
- PostToolUse
order: 10
block: false
---
A non-blocking per-edit annotation. The first time a session edits a given file, it names the spec node(s) that GOVERN that file — and, when a file is over-owned, flags that it is doing too much and points at the split — so the contract is in view at the very moment of the edit, not only later at commit or drift time.

It never renders a verdict: it only adds context, so it can inform without interrupting. Like [[spec-first]], spec-awareness is universal — it is NOT gated on `governed` and runs for any agent. It is deduplicated once per file via a ledger that lives as a sibling file in the session's global store dir (keyed by the payload's `session_id`), so a fifty-edit refactor annotates each file once rather than on every write — the discipline that keeps a pervasive signal from decaying into the noise it is meant to cure. It speaks only when there is something to say: a sanely-owned file draws silence, an over-owned or uncovered one draws the pointer.

This is the at-the-keystroke companion to the read-first gate [[spec-first]] and the commit-time checks: together they keep the [[core]] rule — code must not silently diverge from its spec — visible across the whole edit loop.
