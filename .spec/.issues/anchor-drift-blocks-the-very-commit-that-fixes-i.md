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

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T08:35:51.499Z -->
CLARIFICATION — nothing is broken today, and the reason is the sharpest statement of the trade in
this whole thread.

Post 12 could be misread as "ack doesn't work". It works fine. "Ack cannot act at staging time" is
a constraint on the PROPOSED change, not a description of current behaviour.

Today's sequence, and why it passes:

    you commit (moving an anchored unit)   the gate reads history; your commit isn't in it -> PASS
    the drift now exists                   it landed, so it is in the window from here on
    you ack                                there is something to point at -> cleared

Which means:

    "one commit late" and "ack works" are THE SAME PROPERTY.

The gate never judges the commit being made. That is simultaneously:

  - why the author who moves an anchored unit sails through (the defect this issue opened on), and
  - why a post-hoc ack has a commit to speak for (the front door that answers the 28%).

Two faces of one coin. Removing the lateness removes the front door — which is exactly why my
proposal stranded those 76 commits. Ack did not break; I removed the ground it stands on.

    today                      late: yes   ack usable: yes
    hypothetical               late: no    ack usable: NO
    hypothetical + trailer     late: no    ack usable: yes

Only the third row is coherent, and the trailer is not a patch bolted on to make it work — it is
what moves ack from "after the commit" to "inside the commit", which is the only way to have both
faces of the coin at once.

Also correcting my own sloppiness: in the scratch experiment behind post 9 I passed
SPEXCODE_SKIP_LINT=1 on the drift-CREATING commit out of habit. It was unnecessary (the tree
started at 0 errors, so that commit would have passed on its own) and it means that experiment did
NOT demonstrate "the creator sails through". That claim rests on real history instead: 847ee8c4's
commit body carries no bypass marker — it passed clean.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T08:48:48.609Z -->
DESIGN, cut down by the maintainer. Two pieces, not three.

I had proposed a third piece — "block only on findings THIS commit introduces" — to stop
historical debt from ambushing an unrelated committer. The maintainer rejected it as an
over-complicated condition. He is right, and the reason is stronger than "too complex":

    if the first two pieces hold, debt cannot ACCRUE. Every commit answers at its source or does
    not land. So the only debt piece 3 protects anyone from is the BACKLOG that exists the moment
    the fix ships — a one-time migration, not a standing condition.

I had encoded a migration as a permanent special case.

Cutting it also restores something worth keeping: if someone forces debt in with
SPEXCODE_SKIP_LINT / --no-verify / a hookless clone, the next committer IS blocked. That is the
ratchet, and it is the notification channel the adversary defended in post 8. My piece 3 would
have switched that off too.

## The design, entire

    1. `Spec-OK:` trailer becomes ack's staging-time form
    2. judge at commit-msg: "assuming this commit lands, is the rule violated?" — block normally
       + clear the existing backlog once, at adoption

## On (1) not being a new idea

Worth stating plainly, because it looked like I was inventing a mechanism. "Git is the database"
is this project's existing core: nothing stores spec metadata, it is all computed from git.

    node version   = the number of content commits to its spec.md
    version reason = that commit's subject
    version author = the `Session:` trailer in that commit's body
    history tab    = a git log walk over that path

Concretely, the archive node reads v4 on the board because `git log -- .spec/…/archive/spec.md`
returns exactly four commits; the number lives nowhere else. And the `Session:` trailer is written
automatically by the shipped `prepare-commit-msg` hook.

So structured facts in a commit message, read back later, is the established pattern here — not a
new one. And `Spec-OK:` is not even a new trailer: `ackCoverFor` reads exactly this trailer today,
just out of committed history. Piece 1 is therefore not "add a trailer"; it is "let the existing
trailer be seen one moment earlier".

The hook symmetry that makes it possible:

    prepare-commit-msg   before the message is final   SHIPPED   writes `Session:`
    commit-msg           after it is final             empty     could read/validate, can still block

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T08:52:07.992Z -->
CORRECTING MY OWN ARGUMENT, and recording a fragile contract the probe exposed.

## I argued piece 1 with the wrong example

I justified "put structured facts in the commit message" by pointing at the `Session:` trailer.
The maintainer called that out: `Session:` is attribution for a history view. Display. Low stakes.
Using it to argue for a gate input is weak, and he is right.

The example I needed was sitting next to it. On a real ack commit (4be2ab67):

    $ git log -1 --format=%B 4be2ab67 | git interpret-trailers --parse
    Spec-OK: session-console          <- a GATE INPUT
    Session: abe9f2bd-…               <- the display one

`Spec-OK:` is already parsed out of a commit message today, and it already decides whether drift
blocks you — that is what `ackCoverFor` reads. So the precedent is not "this project writes
trailers". It is:

    THE ACK MECHANISM IS ALREADY A COMMIT-MESSAGE TRAILER.

Piece 1 therefore introduces no new message parsing whatsoever. It moves the EXISTING parse one
step earlier. I should have led with that instead of reaching for the decorative case.

(On "that isn't structured": `git interpret-trailers` is git's own trailer parser and `Key: value`
is its format, not free text. The two lines above are its output.)

## prepare-commit-msg vs commit-msg, measured

    1) pre-commit           message file holds the PREVIOUS commit's text — this one has none yet
    2) prepare-commit-msg   receives the DRAFT; may rewrite it (this is where `Session:` is stamped)
    3) commit-msg           receives the FINAL text; may read it and reject

prepare = the form template you are handed. commit-msg = the review when you hand it back. Only
the second sees what will actually be committed, which is exactly what a gate needs: `Spec-OK:` is
an AUTHOR'S declaration, and at prepare time the author has not written it yet (or could still
delete it afterwards).

## A fragile contract the probe exposed — worth guarding when this ships

In my probe the `Spec-OK:` line I wrote was NOT parsed. Cause: `prepare-commit-msg` appended its
own line after a BLANK line, splitting the message into two paragraphs:

    probe: my change
                              <- blank
    Spec-OK: session-console
                              <- blank
    Auto-Stamped: by-the-hook <- git only treats the LAST contiguous block as trailers

git recognises only the final contiguous paragraph as the trailer block.

Real history is fine — SpexCode's `prepare-commit-msg` appends `Session:` directly ADJACENT to
`Spec-OK:` (visible on 4be2ab67; both parse). But that is an implicit, unguarded contract: the day
anything inserts a blank line between them, `Spec-OK:` silently stops being a trailer, the gate
stops seeing the ack, and nothing complains.

If piece 1 ships, this must be made explicit — validate that the trailer block is contiguous, or
write via `git interpret-trailers --if-exists addIfDifferent` rather than a bare append. A silent
failure mode in the escape valve is worse than no escape valve.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T08:55:27.426Z -->
REPLACING MY PATCH WITH THE INVARIANT — the maintainer's correction: solve this formally, not with
an engineering guard.

In post 15 I proposed "validate that the trailer block is contiguous". That is a sentry posted
downstream of a broken abstraction. It can be forgotten, and it needs someone to keep remembering
why it exists.

## The structure

A commit message is a STRING. Trailers are a structure DERIVED from it:

    trailers : String -> Set<Key x Value>

That derivation is context-sensitive — only the final contiguous paragraph qualifies — so it is
NOT a homomorphism:

    trailers(m1 ++ m2)  !=  trailers(m1) U trailers(m2)

Stamping is a transformation `stamp : String -> String`, and the property we actually need is

    INVARIANT:  for all m,  trailers(stamp(m)) SUPERSET-OF trailers(m)

i.e. stamping may add, but must never make an existing declaration disappear.

## The root cause is a level confusion

Today `stamp` is defined at the STRING level (`m ++ "\n\nSession: X"`), while the property it must
preserve lives at the TRAILER level. An operation at the lower level owes the higher level
nothing — so it violates the invariant, silently. My contiguity check did not remove the level
mismatch; it stationed an observer downstream of it.

## The fix is to move the operation to its own level

    today:  stamp(m) = m ++ "\n\nSession: X"                  string-level
    should: stamp(m) = interpret-trailers(m, +Session)        trailer-level

Measured, same author message either way:

    string append          trailers = { Session }                   <- Spec-OK swallowed
    interpret-trailers     trailers = { Spec-OK, Session }          <- preserved, adjacent

`git interpret-trailers --trailer` is DEFINED as "add into the trailer block". It preserves
trailers not because we were careful but because that is its semantics. The invariant then holds
BY CONSTRUCTION — no sentry, no pinning test, no comment for posterity.

It is also complexity-negative: the patch adds a check to maintain; the level change deletes the
string concatenation and gets the property for free.

## How "parse it earlier" actually works — no magic

`ackCoverFor` reads `idx.acks`, a map `commit sha -> node ids that commit declares`, built by
walking history and parsing each message's trailers. Earlier means the same parser on a different
input:

    today       acks : Map<Sha, Set<NodeId>>   built from committed messages
    commit-msg  the same map, plus  PENDING |-> trailers($1),  with the window tip = PENDING

`$1` is the message file git hands `commit-msg`, byte-for-byte what will be committed. So

    parse(pending file)  ==  parse(the message later read from history)

holds by construction, given the same parser on both sides. No approximation — one function, one
byte sequence, obtained one step sooner.

## The two are one thing

Once `trailers(stamp(m)) SUPERSET-OF trailers(m)` holds by construction, `parse(pending) ==
parse(committed)` holds by construction too.

Whether the gate can move earlier depends on the declaration surviving transport intact — and the
declaration gets corrupted precisely because the stamping operation sits at the wrong level. So
fixing `stamp` is not an incidental cleanup discovered along the way. It is the PRECONDITION for
moving the gate at all. Treating them as two separate items was itself the engineering reflex the
maintainer is calling out.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T09:01:04.759Z -->
WHAT Spec-OK ACTUALLY IS — asked by the maintainer, and it settles how much of the design already
exists.

`Spec-OK` is a property of the COMMIT, carried in its message; it is NOT attached to any file. But
its SCOPE is per-node. Both halves matter and they are easy to conflate.

    spex spec ack A B C
      -> git commit --allow-empty
           --trailer "Spec-OK: A" --trailer "Spec-OK: B" --trailer "Spec-OK: C"

    parsed as:  acks : Map<commit hash, Set<node id>>

One trailer per node; the payload is a SET of node ids. git.ts states the scoping rule flatly:
"`Spec-OK: A` quiets A's drift, never B's". So it is a commit-level CARRIER with node-level EFFECT
— not "let this whole commit through", but "this commit declares A and B unbroken".

It reads like a whole-commit property today only because the ack commit is EMPTY (`--allow-empty`).
That commit exists for no reason other than to carry the sentence, so in its current form the
declaration and the commit really are the same object.

## Why this settles the design's cost

Under the trailer proposal the same trailer stops being a standalone stamp and becomes a
declaration welded to the change it is about:

    today   commit A: moves the anchored unit, says nothing
            commit B: empty, exists only to say `Spec-OK: session-console`
            -> the declaration and the change it speaks for are two separate commits

    design  commit A: moves the anchored unit + trailer `Spec-OK: session-console`
            -> who moved it and why the contract still holds, in one commit

And the existing "one trailer per node" shape is already sufficient: a commit hitting three nodes'
anchors writes three `Spec-OK:` lines, and the semantics are a set by construction. No new syntax
is invented.

So every piece of expressive power the design needs EXISTS TODAY: the payload (a node set), the
carrier (a git trailer), the parser (`ackCoverFor`). The only missing thing is that it must be
able to ride a commit that has content, and be read at commit-msg time.

Which is also, again, why `stamp` must move to the trailer level: a real commit's message will
carry BOTH the author's `Spec-OK:` and the hook's `Session:`, and they must share one contiguous
trailer block. Today's string append pushes the author's line out of that block — the silent
failure measured in post 15/16. The precondition is not incidental; it is the thing that makes a
content-bearing ack possible at all.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T09:08:01.208Z -->
CORRECTING POST 16 — the precondition I said was missing is already implemented. I argued from an
artefact of my own probe.

Post 16 claimed `stamp` is defined at the string level and must be moved to the trailer level.
SpexCode already does the trailer-level thing:

    spec-cli/templates/hooks/prepare-commit-msg:33
    git interpret-trailers --in-place --trailer "Session: $SPEXCODE_SESSION_ID" "$msg_file"

So `trailers(stamp(m)) SUPERSET-OF trailers(m)` holds by construction TODAY. The silent failure I
measured in post 15 came from my probe, where I had written the stamping myself as `printf >>` —
a string append. I reproduced a defect I had authored, then argued the product had it.

There is therefore no "piece C". It is done. The design reduces to one change: move the gate to
commit-msg.

## How an author actually declares — measured end to end

    git commit -m "fix: move the anchored unit" --trailer "Spec-OK: session-console"

Resulting committed message:

    fix: move the anchored unit

    Spec-OK: session-console      <- author's
    Session: abe9f2bd             <- hook's

Both land in ONE contiguous trailer block and both parse. Author-written and hook-written trailers
compose correctly with no coordination — which is exactly the property interpret-trailers provides
and the reason the level argument mattered, even though the product already had it right.

Multiple nodes: repeat `--trailer` (which is what `spex spec ack` already does internally).

## Knowing WHICH node to name

The gate says so. Today's anchor-drift error already carries the node id
("... since spec 'session-console' v169"), so the loop is: commit -> blocked, node named -> retry
with that name in a `--trailer`. Two commands, the second copied out of the error text.

That is the same operation count as today ("blocked -> run `spex spec ack <node>`"). The only
difference is where the declaration lands: welded to the change instead of in a separate empty
commit.

## The cost I am not glossing

An agent writing a long message via heredoc must put the trailer at the end of the heredoc, or
switch to the `--trailer` flag. Minor, and it is not new for `Session:` (the hook handles that one
invisibly) — but `Spec-OK:` must be written deliberately by the author. That is correct: it is a
claim, and a claim should not be automated.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T09:20:45.760Z -->
CORRECTION — I said the ack source is the commit SUBJECT and that trailers are merely decorative.
Wrong. I read one of two code paths and generalised. The maintainer asked whether the subject was
chosen for a reason; checking that question is what surfaced this.

There are TWO index builders, with DIFFERENT criteria:

    git.ts:536  buildLazyDriftIndex   --grep='^ack: Spec-OK'  +  %s          <- subject
    git.ts:575  buildDriftIndex       %(trailers:key=Spec-OK,valueonly,…)    <- TRAILER, git-native

So the trailer is already the source on the eager path, using git's own trailer extractor. And the
subject IS there for a reason: `--grep` prunes the walk inside git, so the lazy path never has to
fetch a full body per commit. That is a sound optimisation, not an oversight.

## What this changes

    path                          a content commit carrying a `Spec-OK:` trailer
    eager  buildDriftIndex        RECOGNISED
    lazy   buildLazyDriftIndex    NOT recognised

One concept, two criteria. Invisible today because `spex spec ack` guarantees the subject format,
so both paths agree on every ack that exists. But the moment `Spec-OK:` may ride a commit with
content — which is exactly what this design requires — the two paths DISAGREE: eager honours the
declaration, lazy does not.

So piece 1 is not "change the source of truth from subject to trailer" (which sounded like
inventing something). It is: **make the lazy path's criterion agree with the eager one.** The
payload, the carrier, the parser and one of the two readers are all already correct; a
performance-motivated prune quietly narrowed the semantics on the other.

That also drops piece 1's cost from "change a mechanism" to "reconcile an inconsistency" — and it
is worth fixing on its own merits, since two readers of one concept disagreeing is a latent defect
regardless of whether the gate ever moves.

Retracting the corresponding claim in my previous post and in the summary I gave the maintainer.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T09:39:53.855Z -->
CORRECTING MY OWN CASE AGAINST THIS PROPOSAL — the maintainer caught an error that inflated it.

I had listed three costs of overturning the recorded decision (spec-lint: "One gate, no
staged-index machinery"; code-anchor: "there is no separate staged-index gate"). Two of them do
not survive scrutiny, and the first was simply wrong.

## Wrong: "one rule would grow two semantics"

I claimed CI has no pending commit, so the rule would need two modes. It does not. It is ONE
function with a different tip:

    judge(tip):  window = (node's last spec.md commit, tip]

    commit-msg   judge(pending)   history as usual, plus one element at the tip
    CI           judge(HEAD)      exactly today's behaviour — CI changes not at all

The staged content does not REPLACE history; it appends one element to it. The implementer had
already said this ("a `tip` parameter threaded through the two index builders, defaulting to
HEAD") and I restated it as a semantic fork. It is not.

## What the real difference is: granularity, not semantics

    local   judge(this commit)   PER-COMMIT
    CI      judge(HEAD)          per-tree

One genuine divergence follows:

    commit A moves an anchored unit, says nothing        -> blocked locally
    commit B would have updated the spec next            -> final tree is clean, CI would pass

So local becomes STRICTLY STRICTER than CI: it forbids iterating across commits and forces code
and spec into one commit. That is the shape the ritual mandates, so it can be read as enforcing
stated discipline — but it does remove a real degree of freedom, and it is precisely the
adversary's objection from post 8. This is the one cost that stands.

## Also weak: my other two

"Gating on the real index would block an ack" — the spec's own words, and the reason the
tree-unchanged door exists. But in this design the ack is a TRAILER on the commit itself; there is
no separate ack commit to be blocked by unrelated staged work. The empty stamp survives for backlog
clearing and still rides the tree-unchanged door. The concern largely dissolves.

"It reintroduces a retired commit-local gate" — `lint.driftErrorThreshold` was retired because its
CRITERION was wrong (a commit count says nothing about whether the contract was touched), not
because commit-local gating is wrong. This design keeps the spatial criterion and only changes the
tip. Weak objection.

## Revised balance

    against    local strictly stricter than CI — no cross-commit iteration
    for        the 28% gain a front door (a content-bearing ack, impossible when the decision was
               made — `Spec-OK` could only ride an empty stamp then), and cost stops transferring
               to the next committer

My earlier recommendation (do the re-anchoring first) still holds, but NOT for the reason I gave.
Not "B costs too much". Rather: the measured cause of the friction I actually hit is the 83%
file-sized anchor, which is unrelated to this decision, and fixing it is zero-risk. Whether B is
still worth overturning a recorded decision should be judged AFTER that, on whether the pain
remains.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T09:46:25.819Z -->
MEASURED THE ANCHOR-SPAN DISTRIBUTION — and it retracts the doctor-check proposal that three
agents and I had converged on.

Ran the project's own extractor over all 119 anchored `code:` entries:

    span 80-100% :  8
    span 60-79%  :  7
    span 40-59%  : 13
    span 20-39%  : 22
    span  0-19%  : 69      resolved 119, unresolved 0

Top of the distribution:

     95%  ( 172/ 182)  session-rename #SessionContextMenu
     93%  (  97/ 104)  reconnect #createResilientSocket
     87%  ( 110/ 126)  tooltip #TooltipLayer
     85%  (  40/  47)  resizable-panes #useResizable
     83%  ( 882/1060)  session-console #SessionInterface
     81%  (  59/  73)  node-menu #NodeContextMenu
     80%  ( 563/ 707)  event-detail #EventDetail
     80%  (  36/  45)  forge-cache #ForgeCache

## The proposed check would be mostly false positives

A "warn when an anchor spans > ~60% of its file" rule flags 15 entries, of which the large majority
are CORRECT anchors: a file that contains exactly one component or one function SHOULD have an
anchor covering ~95% of it. `SessionContextMenu` at 172/182 lines is not a smell; it is a
single-purpose file, anchored precisely.

So the check I proposed (and that the taste and adversary lenses both independently suggested)
measures the wrong quantity. It would also add a THIRD heuristic to a surface that spec-lint's body
deliberately keeps minimal — "heuristic spec health is deliberately absent from this registry",
with doctor owning "the one altitude implementation and the one breadth implementation". Adding a
noisy third is exactly the complexity this project declines to spend.

## The distinguishing quantity is absolute size, not ratio

    SessionContextMenu   172 lines (95%)   a real unit
    SessionInterface     882 lines (83%)   a god component

882 lines is what makes `SessionInterface` degenerate — inside a unit that large, any edit anywhere
hits it. That is not an anchoring defect; the component is too big. The ratio is a coincidence.

## Consequences for the plan

1. WITHDRAW the doctor anchor-span check. It is not a pattern, it is one instance.
2. "Re-anchor session-console" is weaker than I claimed: there is no sub-symbol inside those 882
   lines that carries the node's contract on its own. The real remedy is SPLITTING the component,
   which is an independent refactor with its own payoff and does not belong bundled into this
   thread.

So the "do the zero-risk anchor work first" option, which I recommended twice, mostly evaporates
on measurement. What remains is the gate change — against which two and a half of my own three
objections have already been withdrawn.

I would rather record that this reverses my recommendation than leave a tidy plan standing on a
number nobody had measured. Three lenses agreed on that check; none of us measured the
distribution first.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T10:13:03.178Z -->
THE ARGUMENT, FORMALLY. Written at the maintainer's request ("problem / solution / proof"), and now
the basis three codex lanes are implementing and attacking against.

## Setup

History is a DAG. H = current HEAD, P = the commit about to be made, H' = H concat P.
For a node n with anchored unit u(n) in file f(n):

    v(n,T) = the latest commit reachable from tip T that touched n's spec.md      (the version)
    W(n,T) = { c in (v(n,T), T] : c non-merge, and c's hunks in f(n) intersect
               u(n)'s line range AS OF c }                                        (hit window)
    A(n,T) = { c in W : exists ack a naming n with c in reach(a) }                 (acked)
    D(n,T) = W(n,T) \ A(n,T)                                                       (open drift)

Today's gate:  G  =  not exists n. D(n, H) != empty

## Problem

PROPOSITION 1 (the gate's verdict is independent of what it judges).
G's argument is H, and H does not contain P. Hence for any two candidate commits P1, P2, G returns
the same answer. QED.

One line, but it is the whole defect: a gate deciding whether P may land evaluates a predicate that
does not mention P. Two corollaries, both measured in this thread:

  (a) a P that INTRODUCES drift is admitted   — P's hit is not in W(n,H), since P is not in H
  (b) a P that REPAIRS drift is rejected      — P touching spec.md cannot move v(n,H)

PROPOSITION 2 (liability transfers). A hit introduced by P first appears in the window of some
H'' superset of H'. The first commit judged after P pays for it, and that commit's author need not
be P's author. Measured: merge 53451009 carried drift onto main and blocked every worker.

## Solution

    G' = not exists n. D(n, H') != empty          same predicate, different tip

and A must be able to contain P, which requires the in-commit declaration:

    A'(n,T) = { c in W : exists ack a naming n with c in reach(a) }
            union { c in W : c's own message declares Spec-OK: n }

## Proof

THEOREM 1 (the ritual shape passes by construction).
If P touches both u(n) and n's spec.md: P touches spec.md so v(n,H') = P; hence
W(n,H') = (P, H'] = empty since H' has tip P; hence D(n,H') = empty. QED.
Note it passes because the WINDOW IS EMPTY, not by an exemption clause. This is the formal content
of "derived, not bolted on" — and it is why the staged-set exemption I proposed and retracted twice
was the wrong shape both times.

THEOREM 2 (the offender is caught at its source).
If P intersects u(n) and touches neither n's spec.md nor declares Spec-OK: n, then
v(n,H') = v(n,H), so P is in (v, H']; P intersects, so P is in W(n,H'); no ack reaches P (prior acks
cannot, P declares nothing), so P is not in A'; hence D(n,H') contains P. QED.

THEOREM 3 (the trailer is NECESSARY, not a convenience).
Claim: without an in-commit declaration there exists a correct commit that is unconditionally
rejected. Let P intersect u(n) where n's contract genuinely still holds and P's author does not own
n. Three moves exist and all are closed:
  - amend n's spec.md — a false statement about a contract the author did not change;
  - a PRIOR ack a — A is defined by reach(a), and P is a DESCENDANT of a, so P not in reach(a)
    (measured: ack-then-hit still errors);
  - a LATER ack — requires P to land first, and G' rejects P.
Hence P is rejected under every available move. QED.
This is the formal version of the measured 76-commit case, and it is why the trailer cannot be
deferred to a follow-up: without it G' is incomplete.

THEOREM 4 (completeness with the trailer).
For any P intersecting u(n), at least one move makes G' hold: P touches n's spec.md (Theorem 1), or
P declares Spec-OK: n (P in A', so P not in D). Every commit has an available path. QED.

COROLLARY (merges are neutral for free).
W excludes merge commits by definition, and a merge's --unified=0 diff yields no hunks, so a merge P
contributes W = empty for every n and G' is vacuously true. No special case needed.

## The cost, also formally

    local admits B = P1..Pk  iff  for all i,n. D(n, H concat P1..Pi) = empty     per-commit
    CI    admits B           iff  for all n.   D(n, H concat B)      = empty     per-tree

STRICT INCLUSION: { B : local admits all Pi } is a proper subset of { B : CI admits B }.
Witness: P1 moves u(n), P2 updates n's spec.md. CI sees v = P2 so W = empty and passes; local
already rejected P1.

So local becomes strictly stricter than CI: it forces code and spec to land atomically — which the
ritual already mandates, so the restriction coincides with a stated discipline — but it does remove
cross-commit iteration. This is the one real cost and it must not be glossed.

Unity is NOT broken: judge(tip) is one predicate; CI passes H, the gate passes H'. Parameterisation,
not a second implementation. My earlier claim that this forks the rule into two semantics was wrong
and is retracted in post 20.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T10:58:53.405Z -->
CONSOLIDATED ACCEPTANCE LIST — three lanes are implementing/attacking against criteria scattered
across dozens of messages. This is the single authoritative list, so nobody reconstructs it from
chat. Everything below was MEASURED in this thread unless marked otherwise.

## The bar

    NOT "perfect coverage". The bar is NO WORSE THAN TODAY on every path, better on some.
    A cell that is worse AND unrecoverable        -> the candidate is out.
    A cell that is worse but recoverably so       -> a cost; write it in the spec body.
    Recovery counts only if it is HONEST and bounded — an action that requires the author to
    state something untrue is not a recovery path.

## Architecture both lanes converged on (independently, under adversarial pressure)

commit-msg ARMS a marker; `reference-transaction` at `prepared` reads the REAL new oid and lints
with it. Rationale: amend is undecidable at commit-msg, so any design that PREDICTS the pending
commit's parents has an unacceptable cell. Reading the real object removes the guess entirely.
Fallback: no marker / no canonical ref hook -> pre-commit keeps today's old-HEAD gate.

## Discriminator for ack kind (corrected twice)

    stamp ack  <=>  |parents(c)| == 1  AND  tree(c) == tree(parent(c))     covers reach(a)
    self ack   <=>  everything else                                        covers {a} only

The parent-count clause is NOT decoration. Measured: `git merge -s ours` produces tree ==
first-parent tree while making commits newly reachable; without the clause such a merge carrying
`Spec-OK:` would checkpoint the whole side branch's debt. Root cause of the earlier miss: we were
testing "did content change" while an ack's authority is over REACHABILITY. The criterion must be
the same dimension as what it authorises.

Backward compatible: every existing ack is `commit --allow-empty --only`, i.e. one parent and an
unchanged tree, so all of history lands in the stamp branch unchanged.

## Mandatory cases (highest priority first)

 1. SELF-ACK MUST NOT WASH HISTORY. C1 = old unanswered debt; P = content commit carrying
    `Spec-OK: n`. Both land (bypassing the gate). HEAD lint MUST still report C1.
    Mechanism it guards: git.ts:706 `cover.push(ancestorsOf(h))` — an ack covers ALL its
    ancestors, which is right for a stamp and wrong for a self-declaration.
 2. NO CROSS-NODE WASHING. Shared file; C1 self-acks only A, C2 self-acks only B. HEAD must report
    C2 for A and C1 for B. (Already caught one lane using a global boolean here.)
 3. `-s ours` MERGE MUST NOT CHECKPOINT. Side branch holds unanswered C1; trunk merges with
    `-s ours` and a `Spec-OK: n` trailer. HEAD lint MUST still report C1.
 4. AMEND MUST NOT BE FALSELY REJECTED. HEAD = C, a spec-only commit, lint green. Author runs
    `git commit --amend -m` adding code. MEASURED: today's pre-commit passes it (0 errors), and
    the real replacement contains spec.md + code together. A fixed `-p HEAD` design rejects it —
    confirmed a false rejection, not par. Recovery via `Spec-OK` is NOT honest here: the spec body
    scopes that trailer to implementation-only changes, and this replacement changes both.
 5. RECOVERABILITY AFTER A REF REJECTION (five conditions): branch ref unchanged; staged and
    sequencer state intact; error text names both continue and abort; after adding spec or trailer,
    continue actually succeeds; abort actually restores. Rationale: auto-abort would destroy the
    author's completed conflict resolution, which violates this repo's "break then recover is
    acceptable when the recovery path is explicit and bounded".
 6. ARM FILTERING. `--no-verify` / localIssues / cherry-pick / rebase / reset / fetch / branch must
    never arm, hence never pay for a lint.
 7. CONCURRENCY. Two concurrent commits in one repo (routine here: workers commit while the issue
    store writes ~328 times/month). A marker overwritten by the second must not cause the first to
    be SILENTLY skipped.

## Hook facts, all measured here

    ordinary       pre-commit Y  prepare Y  commit-msg Y  reference-transaction Y
    --no-verify    pre-commit N  prepare Y  commit-msg N  reference-transaction Y
    clean --no-ff merge          runs pre-merge-commit + commit-msg, NOT pre-commit
    cherry-pick / rebase         prepare/post only

`--no-verify` still running `prepare-commit-msg` is what lets "prepare unconditionally deletes any
stale marker" work: the marker's meaning tightens to "this commit just passed through commit-msg",
which is stronger than a TTL.

prepare-commit-msg's `$2` distinguishes only amends that REUSE the message (`--no-edit`, editor,
`-c`, `-C` -> `source=commit`). `git commit --amend -m` is byte-identical to an ordinary commit
(`source=message`). So amend is PARTIALLY decidable at prepare, not decidable at commit-msg.

## A rejected reference-transaction leaves nothing that pollutes the gate

MEASURED: HEAD unmoved, staged files intact, the aborted commit does NOT appear in the reflog and
is NOT visible to `rev-list --all`. It exists only as a dangling object visible to `git fsck`, and
is gc-collectable. So window computation cannot see it. This removes one worry about the shared
architecture.

## Standing warning

Two lanes converging on one architecture is NOT evidence that the architecture is correct,
especially after they have seen each other's reasoning. The remaining value of running two
implementations is that independent implementations of the same design cross-check each other —
so they must not merge into one, and must not cite each other's measurements as their own
verification.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T12:12:50.055Z -->
## 对强制验收 #6 的实测扩充 —— 本轮标尺不动

先纠正我自己:我在广播里把 cherry-pick / rebase 的期望值写成 BLOCKED,并称之为"洞"。**这是单方面移动标尺,撤回。**#6 逐字写的是 `--no-verify` / localIssues / cherry-pick / rebase / reset / fetch / branch 从不上膛因此从不付 lint,所以两条候选在这些入口放行是**合规**,与今天持平,HEAD 侧 lint 仍抓得到债。**它不能用来判任何一条 lane 出局。**上面那张 Hook facts 表里也早写了 `cherry-pick / rebase — prepare/post only`,我那次"根因实测"是把已记录的事实重推了一遍。

以下是实测得到的、#6 目前没有覆盖的部分。记录在案,不改本轮验收。

**一、#6 的枚举不全。**同一族里还有两个入口,#6 没点名:

    P20 git revert(被 revert 的是一个只含代码的提交)  ALLOWED  → 落地后 anchor-drift
    P22 git am 打补丁                                  ALLOWED  → 落地后 anchor-drift

两者与 cherry-pick / rebase 行为一致(前置 lint=0,放行,落地后门自己报 anchor-drift)。若 #6 的本意是"回放/应用类入口一律不上膛",应把 revert 和 am 补进枚举;若本意只是列举当时测过的,那这两个入口目前处于未声明状态。

**二、#6 把两类东西归成了一类。**它列的七项里:

  - reset / fetch / branch —— 只移动 ref,不产生任何新创作的提交内容
  - cherry-pick / rebase / revert / am —— **创建新的提交对象**,带内容
  - --no-verify —— 用户显式表达绕过意图
  - localIssues —— issue 存储写入,不是代码

"从不付 lint"的成本理由(每月 ~328 次 issue 写入、fetch/reset/branch 频繁)对第一类完全成立,对第二类不成立:第二类是创作行为,频率与普通提交同量级。

**三、区分点是现成的、便宜的,而且两条 lane 已经实现过。**"这次 ref 更新有没有引入该分支上前所未有的提交"——reset 移向已可达的提交,fetch 引入的是上游的提交,而 cherry-pick / rebase / revert / am 都产生本仓库前所未有的新提交对象。这正是两条 lane 在 P16(`-s ours`:树等于第一父,但让欠债提交变为可达)上已经做对的可达性语义。

**四、真要改 #6,代价必须先算清。**攻击方 2310966c 指出:无记号即执法会把执法面扩大到 localIssues / reset / fetch / branch,必须重开 blast-radius 验收。这是对的,而且是改动 #6 的前置条件,不是可以顺手带过的细节。

**结论:本轮维持 #6 原样。**两条候选在这四个入口上与今天持平,不构成区分度,也不构成出局理由。是否把"创作类回放入口"从 #6 的豁免里摘出来,是一次独立的范围决定,需要人来拍,并且要先跑 blast-radius 验收 —— 在那之前,我不会用这四格评判任何一条 lane。

我个人的看法仍然记在这里,供那次决定参考:一个只在"用户老实用 git commit"时才成立的门,防不住日常操作,而 rebase 与 cherry-pick 的使用者并没有表达任何绕过意图 —— 这与 --no-verify 的豁免理由不同。但这是看法,不是本轮的标尺。

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T13:25:20.106Z -->
## 证据流程:测量必须钉完整 SHA,不能用活工作树

这条是本轮 battle 里代价最大的方法错误,记在证据流程上,不进产品正文(那是事故叙事)。

**发生了什么。**我用 `node <worktree>/spec-cli/bin/spex.mjs` 跑候选的门。这条路径读的是**工作树**,而两条 lane 正在各自的 worktree 上持续提交。P27(TREESAME-first-parent merge)那格:

    我的夹具创建     21:17:07 +0800
    a4a0 e88d507c    21:18:11 +0800   fix: filter empty merge spec patches (git.ts +6/-1)
    我的 lint 测量   在其后

于是我量到的是**修复后**的代码,报出"双方 PASS",把一个真实的假阴性读成了通过。钉死 SHA 重测才看清:

    a4a0@6d237f17   0 error   ← 假阴性,债彻底消失
    a4a0@e88d507c   1 error   by 2 commit(s)   ← 已修
    e36e@ac7ca660   1 error   by 2 commit(s)   ← 一直正确

**为什么它特别难自查。**失败与通过之间只差一次提交,而候选正在被积极修复 —— 修复方向恰好朝着"让我的测量通过"。所以这个错误**只会朝一个方向偏**:把真实缺陷读成通过,永远不会反过来。它不制造假警报,只制造假安心,因此不会有人来纠正你,只会在验收放行后由用户承担。这一次是攻击方 lane 盯着提交时间线才抓回来的。

**规程。**任何跨 session 的候选测量:

1. `git worktree add --detach <dir> <完整SHA>`,测这个目录,不测别人正在写的工作树。
2. 结论必须带被测 SHA;不带 SHA 的性能数与行为格一律作废重跑。
3. 跑前跑后各记一次候选 HEAD;若中途变动,该轮作废,不做"大概没影响"的推断。
4. 同理适用于 cwd:a4a0 lane 同一格上因 cwd 用错得到无效 rc0,两边都被方法咬过。

**这条与本 issue 的关系。**anchor-drift 的整个立论是"门必须判**将要落地的那个对象**,而不是判它旁边那个"。我的测量犯的是同一类错误的镜像:判了候选**旁边那个**版本。同一个认知失误在产品语义和验收方法上各出现一次,值得记下来。
