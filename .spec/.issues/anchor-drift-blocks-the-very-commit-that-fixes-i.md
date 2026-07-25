---
concern: anchor-drift blocks the very commit that fixes it — the gate should let the repairing spec.md through
by: abe9f2bd-3e85-4083-a152-0d89f267521b
status: open
nodes: code-anchor, spec-lint
created: 2026-07-25T05:40:14.923Z
---

## What happens

`anchor-drift` is a lint ERROR, and the pre-commit hook hard-blocks on errors. But the only way to
clear an anchor-drift is to commit a new version of the drifting node's `spec.md` (or an ack, which
is also a commit). So the error blocks the one commit that repairs it. The tree cannot get out of
the state through the gate that is holding it there.

Hit live: an archive merge (53451009) left `anchor-drift ... 'session-console' v167` on `main`. The
fix — rewriting session-console's body — could not be committed until `SPEXCODE_SKIP_LINT=1` was set
(commit 1cc12602, verified 0 errors immediately after). Meanwhile the error is tree-wide, so it was
blocking EVERY worker's next commit, not just the author's.

## Why this is a mechanism gap, not a usage problem

Reaching for the bypass is currently the only exit, which means the escape hatch is load-bearing for
an ordinary, expected repair. That is backwards: the hatch should stay reserved for genuine
emergencies, and a routine fix should pass through the front door.

## The decidable fix

The hook has everything it needs to tell repair from regression. An anchor-drift names the node it
is about, and that node's `spec.md` has a known path. So:

> if the drift-reporting node's `spec.md` is in THIS commit's staged file set, that drift must not
> block the commit.

Staged-set membership is exact — no heuristic, no guessing at intent. A commit that touches the
spec.md is by definition either rewriting the contract or stamping an ack, which are precisely the
two honest remedies the error message itself recommends. A commit that does NOT touch it is still
blocked, so the gate keeps its teeth for the case it exists to catch.

Worth checking whether the same shape applies to the other blocking rules (a commit that repairs an
`integrity` or `mention` error by editing the very node the rule names), rather than special-casing
anchor-drift alone.

## Credit

Found jointly by sessions abe9f2bd (archive lane) and 67c463e8 (`Improve new item creation UI
design`), who caught the drift on `main`, verified its attribution, and deliberately did NOT ack it
on the author's behalf.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T07:13:19.479Z -->
Stays open — the gap is unfixed, and this session hit it a second time.

Repro #2, same shape as the original: fixing the archive star's dead press changed
`SessionInterface.jsx`, which re-triggered `anchor-drift` on `session-console`. The repairing
commit was blocked by the very error it was about to resolve, and only landed once the drift was
answered (an ack, this time — the node's own sentence was still true).

Two commits into the same wall in one session is the argument the original report only predicted.

The proposed fix is unchanged and still decidable: if the drift-reporting node's `spec.md` is in
THIS commit's staged file set, that drift must not block. Both of my encounters would have passed
that test — one rewrote the body, one stamped an ack, and both touch the spec.md by construction.

Closing this before the hook changes would only mean the next person rediscovers
`SPEXCODE_SKIP_LINT=1` on their own.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T07:31:47.943Z -->
CORRECTION — I overstated this. The deadlock is real but NARROWER than reported, and the
mechanism already contains the right idea.

The pre-commit hook opens with a tree-unchanged escape:

    if [ "$(git write-tree)" = "$(git rev-parse 'HEAD^{tree}')" ]; then exit 0; fi

Its own comment names this exact deadlock and solves it for one remedy: "...the lint shim below
reads the real index, which would otherwise block the stamp on the very drift it acknowledges."

So of the two remedies the error message recommends:

  spex spec ack       tree unchanged (empty stamp)  -> passes today, by design
  rewrite the body    tree changed (spec.md edited) -> BLOCKED

Verified on this session's own commits: 1cc12602 (rewrite) needed SPEXCODE_SKIP_LINT=1;
4be2ab67 (ack) went straight through, tree == parent tree.

I had claimed both encounters needed the bypass. Only the first did. The second I answered with
an ack, which has a front door.

This makes the report SMALLER and the fix cleaner. It is no longer "invent an escape" — it is
"the existing escape asks the right question with too narrow a test":

    today:     did this commit change the tree at all?
    proposed:  ...or is the drift-reporting node's spec.md in this commit's staged set?

Both are decidable at pre-commit time, and the second is the same reasoning the first already
encodes: a commit touching that spec.md is by construction one of the two honest remedies.

What stands unchanged: rewriting the body is the FIRST remedy the error text recommends, and it
is the only one that cannot be performed through the gate. An escape hatch should not be
load-bearing for the primary repair path.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T07:37:57.559Z -->
EVIDENCE — why this has sat unnoticed, and why it is worse than "an annoying deadlock".

Measured over the 13 days since the rule landed (12cd6e9e, 2026-07-12):

    ack commits:              69
    SPEXCODE_SKIP_LINT=1:      2   (one is mine; the other is the rule's own author,
                                    while developing the rule)

So apart from this lane, NOBODY on the fleet has cleared an anchor-drift by rewriting a spec
body in 13 days. Every single resolution was an ack.

That is the answer to "why has nobody hit this": the deadlock only appears on the
rewrite-the-body path, and the two remedies have wildly different friction:

    spex spec ack --reason "…"    one command, rides the tree-unchanged escape, frictionless
    rewrite the body              blocked by the very error it fixes, needs the bypass

Nobody experiences a failure. They experience "I'll just ack it." The problem is ABSORBED by
the ack path and never accumulates into a visible fault. 69:2 is the shape of that absorption.

The real defect is therefore not the deadlock — it is an INVERTED INCENTIVE. The error text
lists rewriting the body FIRST and acking second; `--reason` is mandatory; the docs say a blind
ack is a lie. The design clearly wants the body rewritten when the contract moved. But the
mechanics reward the opposite: the honest remedy is gated, the cheap one is not.

The predictable end state is contracts drifting quietly out of true while lint stays green —
which is exactly the state this lane found on main: `spex spec lint: 0 error`, while
session-console's body still claimed liveness alone decides the console surface, with the
archive card already merged and contradicting it. A human review caught that, not the hook.

None of this blames anyone for acking. When one path is one command and the other requires
discovering an environment-variable bypass, the ratio is not a measure of diligence.

Fix is unchanged and now better motivated: let the gate ask whether the drift-reporting node's
spec.md is in this commit's staged set. That equalizes the two remedies instead of taxing the
honest one.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T07:40:49.697Z -->
SECOND, DISTINCT FINDING — the rule is always one commit late, and the cost lands on the wrong
person. (Raised by the human asking the obvious question: if drift is counted from commits, and
my code edit is also merely staged, why does anything block at all?)

The answer is that both sides of the comparison read committed history, symmetrically:

    the drift-CAUSING side   must be committed to count
    the drift-FIXING side    must be committed to count

Nothing staged is visible on either side. So the block was never "my staged edit was misjudged"
— it was "the drift was already in history, and my fix is not history yet".

The consequence follows directly, and is verified on this session's own commits:

  847ee8c4 changed SessionInterface.jsx — the unit session-console anchors — and did NOT touch
  session-console/spec.md. It passed its own pre-commit cleanly, no bypass. The NEXT commit was
  blocked.

At its own pre-commit moment, the offending commit does not exist yet, so history looks clean to
it. The rule therefore NEVER stops the commit that creates the drift; it stops whatever comes
next. And because lint scans the whole tree, "whatever comes next" is not necessarily the same
worktree or the same person.

That is not hypothetical either. Merge 53451009 carried this drift onto main, and every worker's
next commit was blocked repo-wide until it was answered — a neighbouring session (67c463e8)
noticed and came to tell me.

So cause and cost are SEPARATED:

    the author who creates the drift    passes, learns nothing
    the next person to commit anywhere  is blocked, often with no context

This compounds the incentive problem in the previous post. Someone blocked by a drift they did
not create has no basis for judging whether the contract genuinely moved — they cannot honestly
rewrite a body they did not touch. The only defensible action left to them is an ack. The 69:2
ratio is not merely convenience winning; it is partly the mechanism handing the decision to the
one person least equipped to make it.

Worth considering alongside the staged-set fix: whether the gate should also evaluate the
CURRENT commit's own staged content, so the commit that moves an anchored unit answers for it
at the moment it moves it, instead of billing the next passer-by.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T07:43:17.257Z -->
PROPOSED FIX — and a retraction of my own earlier one.

Withdrawing the staged-set exemption I proposed in post 1. Checked against [[taste]] #2 (one
unified mechanism, not special cases) and #3 (spend complexity only to buy it back), it is the
wrong shape: it bolts a SECOND escape hatch beside the existing `tree == HEAD^{tree}` one, two
special cases guarding the same concern. It treats the symptom.

The root cause is one sentence: THE GATE ASKS THE WRONG QUESTION.

    asks today:  does history contain drift?              <- unanswerable at pre-commit
    should ask:  will the commit I am about to make leave drift?

A pre-commit hook exists to judge the commit about to happen. This one inspects history instead —
where the damage has already occurred and blocking anyone is pointless — and is structurally
blind to the thing it is actually gating. Both pathologies (one-commit-late, inverted incentive)
are two faces of that single misalignment.

The fix changes the INPUT, not the rule. Evaluate the anchor comparison against the STAGED tree,
as though it were the next commit:

    moves an anchored unit AND updates that node's spec.md  -> version advances in the same
                                                              commit, no drift, passes
    moves an anchored unit, spec.md untouched               -> blocked HERE, with the author
                                                              present and holding the context
    empty ack stamp (tree == parent tree)                   -> introduces nothing, passes
    drift already in history                                -> reported by spex spec lint (and
                                                              CI), no longer a booby trap for
                                                              the next unrelated committer

Why this BUYS complexity back rather than spending it:

  - the `tree == HEAD^{tree}` escape can be DELETED — an empty stamp introduces no drift under
    the new input, so it needs no special case
  - the staged-set exemption never gets built
  - it is CHEAPER: one staged diff, instead of walking the commit chain
  - the language-adapter seam is untouched. It already extracts symbols from a file blob at some
    point in time; this feeds it the staged blob instead of a committed one. Same operation, no
    new seam, no new row.

And it finally lets the rule see this project's own ritual. CLAUDE.md fuses the code change and
the spec change into ONE commit. At pre-commit time neither is committed, so the current judge is
blind to exactly the shape it is supposed to reward. Judging the staged tree makes ritual-shaped
commits pass naturally, and stops the ones that quietly move an anchored unit without saying so.

OPEN QUESTION I am not going to hand-wave: how should a MERGE commit be judged? Its staged
content carries everyone else's changes, so the merger would answer for them. Defensible — the
merger is the human deliberately landing them on the trunk, and merges are a human act here — but
potentially noisy. That is a judgment call for whoever implements this, not a detail to wave past.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T07:45:17.123Z -->
NARROWING MY OWN OPEN QUESTION — the merge concern in post 5 is smaller than I made it sound.

I flagged "how should a merge commit be judged" as an unresolved judgment call. Thinking it
through against how this project actually merges, most of it dissolves.

1. If every ordinary commit answers for its own anchored-unit moves AT CREATION — which is the
   whole point of the proposed input change — then a branch reaching a merge carries NO
   outstanding drift. The merge transports work that has already been answered for. Merges stop
   accumulating debt instead of inheriting it.

2. The "merger answers for someone else's changes" worry does not hold here anyway. Per the
   dogfood ritual, a merge to main is itself a DISPATCH: the manager hands it back to the
   session, and that session's OWN agent runs the git merge. The one answering IS the author.

3. The reverse direction — merging main INTO a node branch, which I did several times this
   session — is the same story: if each lane answered at its own source, there is no unanswered
   drift to inherit.

What genuinely remains is a ONE-TIME migration question, not a standing design flaw: the drift
already sitting in history from before such a fix ships. That needs a decision (grandfather it to
advisory? sweep it with acks once? re-anchor?), but it is bounded and it expires.

Recording this because I would rather shrink my own open question than leave it looking larger
than it is — an overstated caveat is as unhelpful as an overstated claim, and post 2 of this
thread was already one of those.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T07:52:48.536Z -->
SHARPER FRAMING, from the maintainer — and it relaxes an over-specification of mine.

The gate's question, stated generally:

    "assuming this commit lands, would the rule be violated?"

That is better than post 5's "will this commit leave drift", which still framed the fix as
something done TO anchor-drift. This is the semantics a blocking pre-commit gate should have for
EVERY rule — one mechanism, not a per-rule patch ([[taste]] #2).

It also loosens something I pinned down too early: post 5 prescribes "evaluate against the staged
tree". That is one implementation. The criterion is the hypothetical post-commit state; how that
state is computed is free to be whatever comes out cleanest.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T08:13:36.013Z -->
CONSOLIDATED CORRECTION — three fresh-context agents (implementer / adversary / taste lens) were
run against this thread. They agree, from opposed premises, that most of what I argued here is
wrong. Retracting it in one post rather than drip-feeding.

## RETRACTED

1. "The body rewrite cannot be performed through the gate." FALSE, and my own session contained
   the disproof I failed to read: 847ee8c4 created the drift, 4be2ab67 acked it, 175ecfa7
   committed with no bypass. Ack-then-rewrite works; both commits pass; the rewrite re-versions
   the node and moots the ack. Reproduced independently in a clone at 1cc12602^. My one use of
   SPEXCODE_SKIP_LINT was avoidable ignorance, not a mechanism gap.

2. The 69:2 evidence. Methodologically invalid: acks are git-visible by construction, bypasses
   are invisible by construction (an env var leaves no trace), so "2" counts self-reports, not
   behaviour. The honest denominator: 394 spec.md content commits vs 69 acks since the rule
   landed. The ack RATE fell when it landed (6.7% -> 6.0% per non-merge commit), and acking
   predates the rule by five days. Independently, ~1/3 of those acks are on nodes with no anchor
   at all, which cannot trip the blocking tier. The "inverted incentive" conclusion does not
   follow from this data. Withdrawn.

3. "The tree == HEAD^{tree} escape becomes deletable." Wrong on three independent grounds:
   it sits BEFORE main-guard and is what lets an ack stamp land on the trunk (the fix for
   279a325a); lint is tree-wide so it shields the ack from the whole tree's errors, not this
   node's drift; and the pending commit's message does not exist at pre-commit, so an ack cannot
   identify itself by trailer. It stays.

4. The proposal as phrased fixes pathology 1 only. Historical drift is part of the post-commit
   state, so the next passer-by is still blocked. Post 5 quietly switched to a delta reading to
   cover this — that is a different change, and it forks the hook's semantics from `spex spec
   lint` and CI.

5. Measured consequence of my proposal, using the real anchor engine over post-landing history:
   271 commits hit an anchor; 195 answered in the same commit; 76 did NOT and would be blocked
   with no front door — ack cannot pre-date the commit it must cover (ackCoverFor quiets only
   reachable ancestors). Their per-node distribution matches the ack distribution almost exactly
   (session-console 17/17, dashboard-shell 6/6, event-detail 4/4). Those 69 acks ARE the answers
   to these foreign anchor hits. My fix would have converted them into ~76 traceless bypasses —
   the exact failure mode this issue opens by condemning.

## WHAT ACTUALLY WARRANTS ACTION (all three lenses converge here, and it is not the gate)

session-console anchors SessionInterface.jsx#SessionInterface = 883 of 1061 lines = 83% of the
file. That is a file anchor wearing a symbol's name, and code-anchor's own premise is that the
block criterion must be SPATIAL. This one anchor produces ~25% of all acks and ~22% of the
would-be blocks. No existing rule can see it: one-govern and owners both deliberately exempt
selector-scoped governors, so a god-component under a whole-file-sized anchor is invisible to
every health check.

  1. Re-anchor session-console onto the unit that carries its contract (or split the component).
     Zero mechanism change; removes ~22% of the measured friction.
  2. Add a doctor-tier WARN when an anchor spans more than ~60% of its file — it is pinning a
     file, not a unit. Data-only, restores code-anchor's spatial premise, closes the blind spot
     scoped-governor exemption creates.
  3. Fix the error string: offer the sequence that actually works ("ack first, then rewrite"),
     instead of listing two remedies as if both were one step.

## UNRESOLVED, recorded as disagreement rather than smoothed over

- Adversary vs implementer on whether pending-state judging is viable at all. The implementer
  showed it is ~20 mechanical line-touches IF the pending commit is materialised with
  `git commit-tree -p HEAD [-p MERGE_HEAD]` (not the staged-tree diff I sketched — that shape
  bills the merger and misses ack-answered branches). The adversary's 76-with-no-front-door
  objection survives that variant, because you still cannot pre-ack. A commit-msg trailer might
  bridge it; neither agent claimed that, and I am not going to invent the bridge here.
- Delta scoping (block only on findings THIS commit introduces): the implementer ranks it first
  — smallest change, kills both the incentive gradient and the repo-wide booby trap. The
  adversary opposes it: the tree-wide block is the NOTIFICATION channel, and in this thread's own
  story it is how a neighbouring session discovered the drift and told me.

## ON OVERFIT

The adversary's charge is correct and I accept it: one session replying to itself seven times,
retracting twice, generalising from two personal encounters — and the single number that could
have been checked before proposing anything (does ack unblock the rewrite?) takes one command and
falsifies the premise. Personal friction is a poor proxy for systemic importance.

Leaving this issue OPEN, but its subject has changed: the anchor-span blind spot and the error
string are real and cheap; the gate redesign is not recommended.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T08:22:00.065Z -->
MEASURED — the simultaneous commit, which this project's own ritual mandates, is ALSO blocked.
This is the one thing neither the adversary nor I checked, and it partially reopens the question
on much narrower grounds than my original claim.

Experiment (scratch worktree off HEAD, since removed; repo untouched):

  1. clean start                                       lint: 0 errors
  2. commit that moves session-console's anchored unit
     WITHOUT touching its spec.md                      lint: 1 anchor-drift error
  3. commit staging BOTH more code AND
     session-console/spec.md — the ritual shape        BLOCKED, commit did not land

The block is not caused by the commit being made. It is caused by the PRIOR drift: the window
starts at the spec.md's last commit IN HISTORY, and a staged spec.md does not move it. So:

    once a node carries unanswered drift, EVERY commit is blocked — including a perfectly
    correct one that restates that node's contract alongside the code.

## What this does to the "ack first, then rewrite" front door

It is not a remedy path. It is DEBT CLEARANCE: the ack answers for the EARLIER commits, not for
what you are about to do. Clear the debt, then your correct commit can land.

That is honest when the earlier commits genuinely did not break the contract — someone touched an
unrelated part of the same file. Two statements about two different things; nothing ugly.

It is NOT honest when they did break it. My own incident 1 is exactly that: my archive commits
had made session-console's body wrong (it still claimed liveness alone decides the console
surface). Acking there asserts "the contract still holds" as a precondition for admitting that it
does not. The adversary conceded this as a labelling problem and priced it as "a string". This
measurement says otherwise: in that case the front door requires either a false statement or a
bypass. There is no third option.

## Narrowed proposal

Not the gate redesign I proposed and withdrew, and not "nothing":

    if THIS commit changes a node's spec.md, that node's historical drift must not block it

Same shape as the staged-set exemption I retracted in post 5 — but the justification is different
and, I think, sound this time. It is not to break a deadlock (there is no deadlock; ack works).
It is because:

  - the project's ritual REQUIRES code and spec to land together, and the gate currently punishes
    that shape whenever prior debt exists — the most correct author is blocked exactly like the
    least correct one;
  - the answer to the historical drift is literally present in the commit being judged: the
    contract is being restated. Blocking it demands the author first assert the opposite.

Scope check against the adversary's strongest objection: this does NOT create the 76-bypass
problem, because it never blocks anything that is not blocked today — it only unblocks. A commit
touching a foreign anchor without touching that node's spec.md is unaffected, so the ack path
that answered those 76 cases remains exactly as it is.

I am not proposing to touch the tree-unchanged escape, the window semantics, or the gate's input.
One condition, and it only ever opens.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T08:25:41.951Z -->
RETRACTING POST 9. The maintainer caught a hole in it, and it is worse than I described.

My narrowed proposal — "if this commit changes a node's spec.md, that node's historical drift
must not block it" — keys on WHETHER THE FILE WAS TOUCHED, not on whether anything was answered.

  - move an anchored unit, add a typo fix to that node's spec.md in the same commit, and the
    node's entire historical drift is waived;
  - and not only for that commit. Once it lands, the spec.md content commit advances the node's
    version, the window resets, and the debt is PERMANENTLY gone with no one having answered it.

Today, prior debt forces you through `spex spec ack`, whose `--reason` is mandatory and recorded
in the ack commit body. My proposal deletes that step. I had been treating those acks as friction;
they are the ledger. That is precisely the adversary's defence of the current design — "the acks
are reasoned, not blind... a specific, checkable claim about its own contract" — and my post 9
would have removed it.

## The hypothetical-commit framing is the correct one, and for a stronger reason than I gave

Both approaches make the ritual-shaped commit pass. The difference is where the behaviour comes
from:

    post 9            a hardcoded exemption: touching spec.md skips the check
    hypothetical      no exemption at all. `since` = the node's latest spec.md commit; evaluated
                      as-if-committed that IS this commit, so the window (since, tip] is empty
                      and the node self-clears through the EXISTING semantics

The implementer's report already said this and I under-weighted it when the adversary's rebuttal
landed: "lint.ts:253-256 needs no edit at all... the staged-set exemption the issue author
proposed and then retracted is DERIVED, not bolted on."

A derived behaviour and a hardcoded one can agree on every case observed so far and still diverge
on the case nobody thought of. That is the whole argument for preferring the derivation, and it is
the argument I made in post 5, then abandoned in post 9 by re-proposing the bolted-on version with
a different justification.

## What remains genuinely unsolved — not a detail

The adversary's 76-case survives the hypothetical framing: a commit that moves a unit anchored by
a node whose contract genuinely still holds (28% of anchor-touching commits). Under as-if-committed
judging the hit IS the pending commit, and `ackCoverFor` quiets only reachable ancestors, so an ack
made beforehand cannot cover it. No front door.

Closing that needs "the contract still holds" to be sayable INSIDE the offending commit — the
commit-msg trailer the taste lens proposed — or ack made forward-covering. This is the one thing
none of the three agents converged on, and it is load-bearing: without it, the hypothetical framing
converts those 76 recorded acks into bypasses, which is the objection that sank my original
proposal and it sinks this one too until answered.

So: the framing is right, the mechanism is incomplete, and post 9 was a step backwards dressed as
a step forwards.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T08:31:22.936Z -->
MEASURED — the ack timing, which decides whether the hypothetical framing is complete or not.

Two experiments in a scratch worktree (since removed; repo untouched):

  ack BEFORE the hit   ack session-console, then commit a change INSIDE the anchored unit
                       -> anchor-drift still ERRORS. An ack does NOT cover forward.
                          (ackCoverFor quiets only commits reachable FROM the ack.)

  ack AFTER the hit    commit the change (passes today — it is not yet in the window),
                       then ack -> 0 errors.

A false start worth recording so nobody repeats it: my first attempt appended a comment at the END
of the file (line 1062) and saw a clean lint. The anchored unit is lines 178-1060, so the edit
never hit it. Editing inside the unit is what produces the real result.

## What this settles

Today, "just ack" is a complete answer for the foreign-anchor case, and it is what those 69 acks
are: the hit lands first, then the ack clears it. Nothing is broken about that path.

Under hypothetical-commit judging the ordering it depends on is destroyed:

    today          commit (passes) -> ack (clears)          ack has something to point at
    hypothetical   commit blocked at the gate -> the commit never exists -> nothing to ack

and the obvious workaround — ack first — is measurably unavailable, per the experiment above.
Remaining options for that 28%: rewrite a contract you do not own and that has not changed, or
SPEXCODE_SKIP_LINT. The act of acking is not the problem; the hypothetical framing breaks the
sequencing the act requires, because it removes exactly the "hit lands first" that makes ack work.

## The honest trade

                        one-commit-late / cost-transfer     front door for the 28%
    today               present (hit twice in this lane)     YES (post-hoc ack)
    hypothetical        gone                                 NO

So the framing is right in SHAPE — no bolted-on exemption, the behaviour falls out of the existing
window semantics — but it is not adoptable as-is. It first needs one of:

  - a forward-covering ack (an ack that speaks for the commit about to be made), or
  - a place inside the commit itself to say "this contract still holds" — the commit-msg trailer
    the taste lens proposed.

Without that, adopting it trades a real problem for a different real problem, and converts the 69
recorded acks into bypasses. With it, it is a complete design. That is the whole remaining
decision, and it is not a detail.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T08:34:16.264Z -->
THE ACTUAL GAP, named by the maintainer, and a measurement that shows the missing piece exists.

The maintainer's restatement is sharper than anything above it in this thread:

    ack cannot act at STAGING time.

That inverts the causation the whole thread had backwards. It is not "the gate asks the wrong
question". It is: the gate wants to move earlier than the commit, but its RELIEF VALVE cannot.
`spex spec ack` IS a commit (an empty stamp), so it can only speak about commits that already
exist. Any criterion evaluated before the commit exists automatically leaves ack behind.

So the ordering is fixed: THE VALVE MUST MOVE FIRST. Only then can the gate.

## Measured: which hook holds both halves

Probe repo, hooks printing what they can see (git 2.43.0):

    pre-commit   staged content: YES    message: NO — COMMIT_EDITMSG still holds the PREVIOUS
                                        commit's subject
    commit-msg   staged content: YES    message: YES (passed as $1)
                 trailers parse: YES — `git interpret-trailers --parse` returned
                                 `Spec-OK: session-console`
                 HEAD: still the OLD commit, so the object does not exist yet and a non-zero exit
                 still blocks

This bounds the adversary's "the pending commit's message does not exist at gate time" — true for
pre-commit, FALSE for commit-msg. `commit-msg` is the only moment holding BOTH what changed and
what the author declared.

## What that buys

The staging-time form of an ack is a `Spec-OK:` trailer on the commit being made. Not a new
vocabulary: `ackCoverFor` already reads exactly that trailer — just out of committed history. Same
word, read at a different moment.

    today          commit passes -> post-hoc ack          ack has something to point at
    hypothetical   commit blocked -> nothing to ack       BROKEN
    + trailer      declare in the commit -> gate accepts   author present, reason lands with the change

And it is arguably STRICTER than today: a post-hoc ack is a separate commit, detached from the
change that provoked it. A trailer is welded to that change — who moved the unit, and why the
contract still holds, in one commit.

## Not claiming this is ready

Two things I did NOT verify, and will not pretend around:

  1. Does `commit-msg` see the TEMP index under `git commit -a` / `--only`? My probe used plain
     staging. The implementer measured that pre-commit gets `GIT_INDEX_FILE` pointing at a temp
     index, and that git.ts's env-strip blinds `stagedFiles()` there (filed separately). Whether
     commit-msg behaves the same is untested.
  2. Merges. A clean `--no-ff` merge does not run pre-commit at all (filed separately); whether it
     runs commit-msg is untested. If it does not, the merge path stays ungated regardless.

Neither affects whether the maintainer's diagnosis is right. Both affect whether the fix ships.
