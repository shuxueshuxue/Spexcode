---
title: review-payload
status: active
hue: 205
desc: The session-side review bundle, the fork-anchored diff and its comment doors, and the merge dispatch — one module the cockpit and the eval package both read, owned by neither.
code:
  - spec-cli/src/session-review.ts
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/cockpit.ts
  - spec-cli/src/index.ts
  - spec-cli/src/eval-host.ts
  - spec-eval/src/sessioneval.ts
  - packages/spec-core/src/git.ts
---

# review-payload

## raw source

Everything a manager reads before deciding about a session — the branch facts, the diff, the review
comments, and the prompt that lands the work — used to live inside `sessions.ts` with no node of its own.
[[manager-cockpit]] described `reviewPayload` in its body but could not own the code, because it already
governs `cockpit.ts` and a node governs one file. [[sessions-core]] owned the file it happened to sit in,
which is a fact about a text file, not about a responsibility. So the feature was homeless: four HTTP
routes, a CLI verb, and the eval package's only session input, all governed by whichever spec the
containing file belonged to.

That is the structural mismatch this node closes. The reviewable state of a session branch is its own
concern. It reads a session; it is not part of running one.

## expanded spec

`session-review.ts` answers the question **"what did this session actually do, and can it land?"**. It is
a READER of session state plus git, and the only thing it writes is a review comment. It never moves a
session's lifecycle, never touches `main`, and never merges — `mergeSession` dispatches a prompt and stops
there.

Its dependency direction is the contract. It imports from [[sessions-core]] (`findWorktree`, `deriveLabel`,
`digest`, and the three delivery verbs `sendText` / `resumeSession` / `drainSession`); nothing in
`sessions.ts` imports back. That one-way edge is what lets the eval package call the payload without a
cycle, and it is why the module can be read as a leaf rather than as another region of the session core.

**The bundle.** `reviewPayload(id)` composes ONE answer for a session: ahead-count, non-runtime dirty
files, the fork-anchored diff, the session gates (`conflictsWithMain`, `lint`), and the standing proposal.
Unknown id → `null`, which the route turns into 404 and the CLI into a non-zero exit. Refs are resolved as
a snapshot and re-checked afterwards, so a payload never mixes two generations of the branch.
[[manager-cockpit]] owns what the composed cockpit answer adds on top of this and why that composition
cannot live here.

**The diff is anchored at the fork point, never at `base..HEAD`.** A two-dot diff against a moving base
renders the base's own post-fork commits as the session's edits — work the session never did, offered to a
manager as its output. `mergeBaseDiff` in [[source-of-truth]]'s `git.ts` is the honest anchor, and
`sessionDiff` extends it with the working tree so uncommitted work is visible as itself: committed and
working changes are separate scopes, and untracked files are counted rather than silently dropped.

**Comments are addressed to a diff that can move.** `saveDiffComment` records a comment against the file
and the identity of the text it was written on; `sendDiffComments` delivers the batch into the session as
one ordinary prompt through [[dispatch]], which owes the same delivery guarantee as any other send.
`retractDiffComment` removes an undelivered one. A comment is therefore a draft until it is sent, and
sending is a normal session message — not a side channel.

**`mergeReadiness` is a pre-declaration guard, not a gate on the merge route.** A session proposing `merge`
from a dirty or not-ahead worktree is proposing something that cannot be landed, so the declaration is
refused at the point of declaring, with the reason. It is deliberately cheap and local: `git status` plus
an ahead check, no lint and no conflict projection, because a declaration must not pay for a full review.

**`mergeSession` hands the work back.** The landing is done by the session's own agent in its own worktree
— sync, resolve conflicts, re-run the proof, one `--no-ff` merge, verify — because that is the only place
the proof can be re-run. The server dispatches `MERGE_PROMPT` and reports whether the dispatch landed.
Only a governed session standing at `proposal=merge` may receive it.
