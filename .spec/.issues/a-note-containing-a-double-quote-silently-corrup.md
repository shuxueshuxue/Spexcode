---
concern: a note containing a double quote silently corrupts session.json — the hot-path writer builds JSON by hand
by: abe9f2bd-3e85-4083-a152-0d89f267521b
status: open
nodes: state, runtime
created: 2026-07-25T09:05:23.714Z
---

Hit live, self-inflicted, and reproducible by anyone: I wrote a `--note` containing a `"` (it was
discussing a code snippet), and my session's `session.json` became invalid JSON from that field
onward. Every subsequent `spex session <declare>` then failed with

    no session record for abe9f2bd — this project's store … holds 15 session(s) but not this one

which is a MISLEADING diagnosis: the record was right there on disk, just unparseable.

The damage:

    "note": ""\n\nSession: X\")而它要保的性质在 trailer 层,…
            ^ the value closes immediately; the rest of the line and the following ~10 lines are
              garbage, and json.loads fails at line 13

## Why it happens

[[state]] deliberately specifies that `session.json` is written one-field-per-line so the
pure-shell hot-path hook (mark-active) can value-replace `status`/`proposal`/`note` with a single
sed and never needs jq on the user's box. That is a sound performance decision, but it means a
NOTE — arbitrary human/agent prose — is spliced into a JSON document by textual substitution, with
no escaping. A note will contain quotes, backslashes and newlines eventually; mine did.

So the format's contract ("every key always present, one field per line") is enforced, while the
VALUE's contract (must be a JSON string literal) is not.

## Severity

Silent and delayed. Nothing fails at write time. The session keeps running. It surfaces only at
the next declaration, as a "no such record" error that points the reader at the wrong cause (wrong
id / wrong project). A worker could easily conclude its session was closed.

It also means any agent quoting code in a note — an entirely normal thing to do — can brick its
own record.

## What NOT to do

Do not simply forbid quotes in notes, and do not have the CLI pre-strip them: the note is the
agent's message to a human, and mangling it silently is the same class of defect one layer up.

The honest fix is that whoever writes the value must emit a JSON string literal. If the hot path
must stay jq-free, it can still escape in shell (or the TS layer can own note writes specifically,
since a note is not on the hot path — mark-active's speed argument is about `status`, which is a
fixed enum and needs no escaping).

Recovered my own record by hand (blanked the note; its content survives in this issue and the
session timeline). Filing so the next person is not left staring at a record that exists but
"cannot be found".
