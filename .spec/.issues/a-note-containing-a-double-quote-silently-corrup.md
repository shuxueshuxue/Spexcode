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

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T09:14:10.573Z -->
SEVERITY IS HIGHER THAN I FILED IT — a corrupted record does not merely break declarations. It
silently REMOVES the session from every list surface, with no error anywhere.

Reported from another lane (67c463e8) as a mystery: this session vanished from `spex session ls`
and later reappeared. Their measurements: T1 both `ls` and `ls --all` returned 12 rows without it;
T2 (minutes later) 14 rows with it, status=working. Record healthy at both points as far as they
could see, worktree and tmux intact — so they suspected a blind-watcher snapshot problem.

It was this bug. The window ended at 02:04:57, when I repaired the file. T1 falls inside it.

## Why it presents as a vanished row rather than an error

    layout.ts:216   readRawRecord()  JSON.parse inside try {} catch { return null }
                    -> a corrupted record is INDISTINGUISHABLE from "no record exists"

    sessions.ts     listSessions()   if (!rec || !rec.governed) {
                                       lastKnownSession.delete(id); return null
                                     }
                    -> the row is dropped AND its last-known entry is explicitly purged

`guardSession`'s degraded-read fallback — the mechanism specifically designed so a transient
failure never drops a live session from the board — only engages when the read THROWS. A corrupted
file takes the caught-null path instead, so it bypasses that protection entirely, and even a
long-running backend cannot hold the row.

Net effect: one unescaped quote in a note makes the session disappear from the board, the CLI, and
the API, indefinitely, and nothing reports a problem. A supervisor watching that board would
reasonably conclude the session had been closed.

## This sharpens the fix

It is not only about escaping the note on write (still the primary fix). There is a second,
independent defect: **an unparseable record is treated as an absent one.** Those are different
facts and the difference matters — absent means "nothing here"; unparseable means "something is
here and I cannot read it", which is precisely the case `guardSession` exists to handle.

Making `readRawRecord` distinguish them — parse failure surfacing as an error rather than null —
would route corruption into the existing degraded-read path instead of silent deletion, and would
have turned this incident into a loud one regardless of the note-escaping bug.

Cross-referenced to 67c463e8's separate finding: 25 of 26 `PATROL-REPAIR` log lines carry `sess:`
units, which is real and suggests a genuinely blind watcher. That produces a STALE list that
self-heals on the next cold tick — a different symptom from a row that vanishes and stays vanished.
Both can be true; this issue does not close that one.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T09:19:42.376Z -->
RECHARACTERISED — this is an UNENFORCED INVARIANT, not an accident. Supplements from 67c463e8,
each verified here before filing.

## The invariant is written down, and nothing enforces it

    .plugins/core/mark-active/mark-active.sh:46
    # …no JSON parser. Escape \ / & in the note for the sed REPLACEMENT (the note never contains ").
    note_esc=$(printf '%s' "$note" | sed 's/[\\/&]/\\&/g')

The escape set is `\ / &`, deliberately excluding `"`, and the parenthetical states the assumption
it rests on. A note is arbitrary agent prose; nothing anywhere prevents a quote. Mine contained
one.

So "I broke it" is the wrong framing. The right one: a documented precondition with no mechanism
holding it up. That also names the fix shape — and it needs BOTH halves:

  - WRITE side: escape (or reject) `"` too. Without this, the next shell writer reintroduces it.
  - READ side: distinguish "unparseable" from "absent" and fail loud. Without this, records still
    corrupt — the failure merely becomes audible instead of silent.

Fixing one half alone leaves the defect alive in a different form.

## The READ path steps on the same rock

    mark-active.sh:31
    jget() { sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$rec" ...; }

A naive `"…"` value regex. A quote inside a note does not only corrupt the file on write — it also
makes the hook's own subsequent reads return a TRUNCATED value. Write and read share one wrong
assumption.

## Scope, measured

Core hooks touching `session.json`:

    mark-active.sh   3 touches   WRITES (sed value replacement)
    stop-gate.sh     3 touches   read-only
    idle.sh          2 touches   read-only
    fail.sh          1 touch     read-only

`mark-active` is the only writer, so the write-side fix is one place. But all four share `jget`, so
the truncating-read defect is FOUR places, not one.

Stating the scope the way 67c463e8 suggested, so a fix cannot be scoped too narrowly: *any hot
path that writes or reads `session.json` from shell with no JSON parser.* The performance reason
for that design ([[state]]: mark-active must stay jq-free) is sound; what is missing is that the
VALUE contract — must be a JSON string literal, and must be read as one — is nowhere enforced.

## Withdrawn, for the record

A companion suspicion from the same investigation — that `spex session ls --all` returning the same
12 rows as the default indicated a second gap — is NOT a defect. Zero sessions are currently
archived, so the two are correctly equal; a difference should appear only when something is
actually shelved. Recording it here so it does not get filed later as a phantom issue.
