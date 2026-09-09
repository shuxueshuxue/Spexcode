---
title: loop-in
status: active
hue: 260
desc: The originator loop-in's composing half — one composer for the reply path (`issue reply` and its HTTP route), above the store modules, so a reply's candidate chain — the thread's author — is built in exactly one place.
code:
  - spec-cli/src/loop-in.ts
related:
  - spec-cli/src/mentions.ts
  - spec-cli/src/issues.ts
  - spec-cli/src/issues-cli.ts
  - spec-cli/src/index.ts
---

# loop-in

## raw source

The loop-in's MECHANISM was never misplaced. `notifyOriginator`, `summarize` and `LoopIn` live in
`mentions.ts`, genuine substrate, and they stayed there. What stood at the wrong height was a single INPUT:
deciding WHICH candidates to try. For one thread kind that meant asking the eval package who filed the
record under judgement — and the resolution sat in `localIssues.ts`, a module the eval package imports, so it
could only reach eval through a deferred dynamic import whose own comment explained why it had to be wrong.

A correct mechanism with one mis-layered input is the hardest shape to find, because everything you read is
where it belongs. It is also why the sniffer's hits clustered in `localIssues.ts` and never touched
`mentions.ts`: the pain was recorded where someone had to pay it, not where the defect was.

## expanded spec

loop-in owns the candidate chain and nothing else. It resolves, for one thread, the ordered list of sessions a
reply may be copied to, then hands that list to [[mentions]]'s delivery mechanism unchanged. R3's contract is
untouched: every thread's chain is its author alone; delivery reaches that link when it is online; the copy
is notification only and resolves nothing.

Its altitude is the whole reason it exists as a module. Sitting above the store modules, it imports
`issues.ts` statically, and nothing below it imports it back.

**One composer, and every entry point calls it.** A reply is reachable two ways — the CLI's `issue reply`
and its HTTP route. If each door composed its own chain, the same verb would report different candidates
depending on how it was entered, and no gate in this repo would notice the drift. So both call sites call
the one function here, and it is the only place a chain is built.

Consequently the layers below return facts, not compositions: the local reply hands back its thread, its
author and its dispatch outcomes, and the loop-in is added here. That also makes the
recursion the old code guarded against structurally impossible rather than comment-avoided — there is no
loop-in-shaped field below for a lower caller to re-enter through.
