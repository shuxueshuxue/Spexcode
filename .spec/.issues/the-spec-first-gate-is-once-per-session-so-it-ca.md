---
concern: the SPEC-FIRST gate is once-per-SESSION, so it cannot protect a session that crosses subsystems
by: abe9f2bd-3e85-4083-a152-0d89f267521b
status: open
nodes: inject-spec-first
created: 2026-07-25T09:23:56.147Z
---

Found by failing it myself, in a session where the gate DID fire correctly once.

    .plugins/core/spec-first/spec-first.sh:18
    sent="$sdir/spec-checked"
    [ -f "$sent" ] && exit 0

One sentinel per session. The injected text says so plainly: "(Fires once per session, at the
first governed code read.)"

## What that misses

    early    read spec-dashboard/src/SessionInterface.jsx   -> fires, names session-console   OK
             read that spec, sentinel written
    later    read spec-cli/src/{lint,git,anchors}.ts        -> governed by code-anchor / spec-lint
                                                            -> sentinel present, silent          MISSED

I spent most of a session reasoning about the anchor/lint machinery, proposing a change to it, and
was never prompted to read its contract. I eventually found `code-anchor`'s body only because a
human told me to look — and it contains, in the Judgment paragraph:

    "there is no separate staged-index gate, and `lint.driftErrorThreshold` is retired."

i.e. an EXPLICIT, already-taken decision against the exact thing I had been proposing for hours.
The proposal may still be arguable, but it must be argued as "overturn a recorded decision with
new evidence", not as "fill an oversight". The gate exists to prevent precisely that mistake, and
it was silent because it had already spent itself on an unrelated subsystem.

## The criterion is too coarse for its purpose

A once-per-session sentinel treats "I have read ONE spec" as "I understand this repo's contracts".
For any session that crosses subsystems — the normal case for anything non-trivial — it is
inert after the first read.

Narrowing it is a one-line change of granularity, not a new mechanism:

    today    $sdir/spec-checked              one read exempts the whole repo, forever
    instead  $sdir/spec-checked/<node-id>    a different governor prompts again, once each

Same hook, same injection, same store; only the sentinel key changes. It stays quiet in the common
case (you keep working inside one subsystem) and speaks exactly when the session moves somewhere it
has not read the contract for.

## Note on the obvious alternative

More prose will not fix this. The discipline is already stated forcefully — CLAUDE.md's rule 1
says reading code counts, not just editing it — and I had read that text. I still missed the
contract. The failure was not insufficient instruction; it was a gate whose trigger condition
stopped matching its purpose after the first hit.

This is the same shape as the other defects found this session (note escaping, ack subject-vs-
trailer, unparseable-treated-as-absent): a criterion that is cheap and correct in the common case
quietly under-serves the property it was meant to guarantee, and nothing detects the gap.

Not acting on this in my lane — recording it with the repro.
