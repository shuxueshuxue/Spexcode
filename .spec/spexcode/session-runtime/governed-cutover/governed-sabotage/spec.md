---
title: governed-sabotage
status: active
hue: 280
desc: The negative proof of the governed cutover — every cut legacy facility planted back and poisoned, the real backend and CLI run under a file-syscall tracer, importer reads reported and runtime reads required to be zero against a calibrated tracer.
code:
  - scripts/governed-sabotage-yatu.mjs
related:
  - .spec/spexcode/session-runtime/governed-cutover/spec.md
  - .spec/spexcode/session-runtime/application-service/production-cutin/spec.md
  - .spec/spexcode/session-runtime/application-service/json-migration/spec.md
---
# governed-sabotage

An inventory that says a facility is cut shows that the new path is in use. It does not show that the old path is never
touched — a probing read that ends in `ENOENT` is still a read of the old authority. This node owns the one script that
closes that gap for the governed adopter, and it is deliberately one file: a fixture project with a ready store, the
real launcher starting the real backend, the runtime routes and the real CLI driving the loop, and `strace` counting.

The sabotage is the set of facilities the cutover claims to have removed, planted back exactly where the old runtime
read them and made hostile: a corrupt old queue, a corrupt cursor file, a relation file of a shape no importer accepts,
a garbage timeline, a revocation marker naming the sender, and the retired lock root made read-only. (A well-formed
legacy relation file is deliberately not planted: after the marker it is a migration input by contract, so "cannot
change routing" would contradict the residue rule rather than test it.) The
loop must then behave as if none of it were there — two state changes reach the real watcher as its two prompts in
order and only those two, replay answers from the store, the unparseable relation file introduced nothing, a send to a
"revoked" sender is queued and dequeued through the CLI — and the backend must survive being stopped and restarted with
the poison on disk. The first run of this gate found the opposite: an unparseable artifact made the residue absorber
throw on every canonical access, so one stray file turned the whole backend into a 500 until a person deleted it. The
migrator now quarantines what it cannot parse ([[json-migration]]) and this gate holds that line.

Two counts are kept apart because the cutover contract treats them differently. What a process reads while deciding
whether residue exists and absorbing it is the importer's work: a legacy tree beside a marked store is a migration to
run, never something to read around, and every fresh process — the backend at start, each CLI invocation — must look
once. Those reads are reported as numbers and not judged. What the settled backend reads while serving — with the poison
planted again after it settled — is the runtime's, and that number must be zero on the first start and after the
restart. The zero is admissible only because the same tracer, in the same run, is shown a
real file syscall on a poisoned path by a calibration probe; a tracer that cannot see the class of event it is counting
reports the same zero as one that saw nothing.

`execve` lines are never counted, because a path in an argument vector is a mention, not an access — the error that
once passed a blind tracer. The retained delivery fence and the live record lock are not sabotaged: the inventory keeps
them by name as external-effect fences, and breaking a facility the product still owns would measure a different claim.
