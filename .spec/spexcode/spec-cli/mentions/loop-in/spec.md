---
title: loop-in
status: active
hue: 260
desc: The originator loop-in's eval-aware half — one composer per reply path, above both the store modules and the eval layer, so a reply's candidate chain is built in exactly one place.
code:
  - spec-cli/src/loop-in.ts
related:
  - spec-cli/src/mentions.ts
  - spec-cli/src/issues.ts
  - spec-cli/src/localIssues.ts
  - spec-cli/src/issues-cli.ts
  - spec-cli/src/index.ts
  - spec-eval/src/filing.ts
---

# loop-in

## raw source

The loop-in's MECHANISM was never misplaced. `notifyOriginator`, `summarize` and `LoopIn` live in
`mentions.ts`, genuine substrate, and they stayed there. What stood at the wrong height was a single INPUT:
deciding WHICH candidates to try. For an eval-remark thread that means asking the eval package who filed the
reading under judgement — and the resolution sat in `localIssues.ts`, a module the eval package imports, so it
could only reach eval through a deferred dynamic import whose own comment explained why it had to be wrong.

A correct mechanism with one mis-layered input is the hardest shape to find, because everything you read is
where it belongs. It is also why the sniffer's hits clustered in `localIssues.ts` and never touched
`mentions.ts`: the pain was recorded where someone had to pay it, not where the defect was.

## expanded spec

loop-in owns the candidate chain and nothing else. It resolves, for one thread, the ordered list of sessions a
reply may be copied to, then hands that list to [[mentions]]'s delivery mechanism unchanged. R3's contract is
untouched: the chain is the reading's filer first — read from the TRUNK sidecar and from every LIVE session's
worktree sidecar, since a filer awaiting review sits online in their own tree — then the node's governing
session; delivery reaches the first online link; the copy is notification only and resolves nothing. A
non-eval thread's chain is its author alone, and pays for no eval, specs or sessions import.

Its altitude is the whole reason it exists as a module. Sitting above the store modules AND above the eval
layer, it may import either statically — which no module below eval could. That is what removes the last
back-edge in the spec↔eval package cycle: after this, no module the eval package imports reaches back into it,
transitively or otherwise.

**One composer per path, and every entry point calls it.** A reply is reachable four ways — the CLI's
`issue reply` and `remark add`, and the HTTP route for each. If each door composed its own chain, the same verb
would report different candidates depending on how it was entered, and no gate in this repo would notice the
drift. So the four call sites call the two functions here, and these are the only places a chain is built.
This is the same rule the cockpit review follows for its eval gate, for the same reason.

Consequently the layers below return facts, not compositions: the local reply and the remark write hand back
their thread, their author and their dispatch outcomes, and the loop-in is added here. That also makes the
recursion the old code guarded against structurally impossible rather than comment-avoided — there is no
loop-in-shaped field below for an eval-side caller to re-enter through.
