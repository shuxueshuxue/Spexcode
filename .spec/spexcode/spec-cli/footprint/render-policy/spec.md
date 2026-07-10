---
title: render-policy
status: active
hue: 200
desc: ONE share axis governs SpexCode's footprint in a host repo — spec data always tracked, machine facts never, run residue out-of-tree, and the machine-independent RENDERS carry the single vote — committed | ignored | hidden.
code:
  - spec-cli/src/worktree-sources.ts
related:
  - spec-cli/src/materialize.ts
  - spec-cli/src/layout.ts
  - spec-cli/src/materialize.test.ts
---
# render-policy

## raw source

SpexCode claims software engineering's HEAD — the recording of intent — and its TAIL — the storage of
measurement — and deliberately leaves the MIDDLE, construction, to the harness/agent/test framework;
freshness stitches the two ends into a closed loop. The footprint model follows from that position: the
head and tail (`.spec`, `spexcode.json`, the readings) are the ASSET and live in git like any other
source; everything else SpexCode puts in a repo is either WIRING derived from that asset or a MACHINE
fact, and only the machine-independent wiring is worth a vote. So there is ONE axis — "who sees this
artifact in the shared repo?" — answered once per KIND of artifact, never per usage mode. TRACKING is a
kind-fact; whether tracked data is shared beyond the clone belongs to the push/remote layer, which is not
materialize's business.

## the stories (A–G acceptance walk)

Each story names the mechanism that satisfies it, or the deferred design that will (DEFERRED).

**A — guest postures.**
1. *Total guest invisibility — even the spec DATA hidden in a repo I don't own.* DEFERRED — the lane: the
   spec tree on a same-repo ORPHAN ref, pre-commit/pre-push guards keeping it off shared branches. Shape
   recorded; not built. Untracking the data is NOT the answer (retirement note below).
2. *Full adoption — the team wants everything visible.* `render: committed` + the always-tracked data.
3. *Spec shared, harness private — the team tracks .spec, a machine keeps renders invisible.* Data tracked
   (no knob exists); `render: hidden` in that machine's `spexcode.local.json`.

**B — pollution complaints.**
4. *"You polluted our CLAUDE.md"* — a host-TRACKED contract file: hidden covers it with the clean/smudge
   [[content-filter]], so the index keeps the pristine prose while the working tree carries the block.
5. *"Your generated files dirty `git status`"* — the default `ignored`: the managed .gitignore block.
6. *"Even your ignore rules are noise in our .gitignore"* — `hidden`: the SAME block lives in the per-clone
   `.git/info/exclude`. The ignore block is itself a render artifact, so its HOME follows the same vote —
   the model is recursively self-consistent, no second mechanism.
7. *"A worker's `git add -A` committed your files into our PR"* — data is tracked (so add -A is correct
   there); renders are ignored/hidden per the vote; the seeded host snapshot is exclude-hidden at seed time.

**C — track ≠ push.**
8. *"Version the spec locally but keep it off the shared remote."* Deliberately outside this vocabulary:
   tracking is a kind-fact ("untrack .spec" is unsayable in the schema — the guardrail is the vocabulary,
   not a WARN); where commits GO is the remote/branch layer — a private remote, branch discipline, or
   story 1's deferred lane.
9. *"Does adopting SpexCode touch our remote?"* Never — materialize writes files and per-clone git config
   only; commits and pushes happen through the user's own ritual.

**D — sub-granularity.**
10. *"Readings bloat the tracked tree."* DEFERRED — evidence already lives in `.git/spexcode` blobs; moving
    the reading LOG toward the global store is a named successor, not this change.
11. *".config should be votable separately from .spec."* DEFERRED — naming it a separate class later costs
    no new mechanism; today it rides inside always-tracked spec data.
12. *"Commit one render, hide another."* Refused by design: the vote is per-CLASS, never per-file.

**E — migration and reversibility.**
13. *Switch policies in any order, repeatedly.* The forgetting law ([[harness-delivery]]):
    materialize(P₂) ∘ materialize(P₁) = materialize(P₂); idempotence is the special case P₂ = P₁.
14. *Back out entirely.* `spex uninstall` = materialize(∅) + the global store ([[spex-uninstall]]).
15. *A fresh clone is self-sufficient.* Data arrives by clone; renders regenerate (init/materialize/gate);
    nothing is fetched from another machine.
16. *A fresh session worktree is self-sufficient.* Three transports by kind — checkout, re-render, copy —
    see the seeding section below.
17. *A legacy untrack-private deployment survives the upgrade.* `private: true` reads as `render: hidden`
    plus a loud, non-fatal notice carrying the one-time migration recipe (retirement note below).

**F — mixed team.**
18. *A colleague who never installed SpexCode still gets the contract.* `committed` — the harness's NATIVE
    discovery reads the committed CLAUDE.md/AGENTS.md; nothing to install on their machine.
19. *A colleague without our hooks must not be broken by our artifacts.* Free, by git physics: hooks are
    per-clone plants (never committed) and renders are inert text — nothing executes for a non-adopter.
    Hook granularity is a plant-side fact, not a render concern.
20. *CI without spex.* As 18/19: committed renders are plain files; `spex lint` in CI is opt-in.

**G — ergonomics.**
21. *"How do I choose and migrate?"* `spex guide footprint` is the model manual; `spex guide config`
    documents the `render` field.
22. *"Show me my current footprint / set it up for me."* DEFERRED — a policy-aware footprint inspect +
    scaffold wizard ([[doctor]] audits the artifacts today).

## expanded spec

The four kinds, each with a FIXED track/transport fact:

- **Spec data** — `.spec/` (including `.config/`, story 11) + `spexcode.json`: ALWAYS tracked. Git is the
  database; no configuration can untrack them.
- **Machine facts** — `spexcode.local.json`, the hook shims (`.claude/settings.json`, `.codex/hooks.json`),
  plugin bundles (they bake this install's paths): NEVER tracked, no vote; always in the ignore rules,
  whatever those rules' home.
- **Machine-independent renders** — the contract blocks in CLAUDE.md/AGENTS.md and the rendered
  skills/agents: the ONE voted class. `render` ∈ `committed` | `ignored` (default) | `hidden`, read through
  the committed-config + local-overlay seam ([[portable-layout]]): `committed` is a project fact →
  `spexcode.json`; `hidden` is a host/person fact → `spexcode.local.json`. An unknown word fails loud.
- **Run residue** — `.worktrees/`, the global store, `.git/spexcode` blobs: never tracked; out of tree, or
  ignore-ruled where in-tree (`.worktrees/`).

Concretely: `committed` writes the renders as ordinary committable files and REMOVES their entries from the
ignore block (machine facts stay ignored); `ignored` keeps renders generated with the managed block in the
tracked `.gitignore`; `hidden` moves the whole block to `.git/info/exclude` and covers a host-TRACKED
contract file with [[content-filter]]. A host-tracked contract file under `ignored` stays honestly dirty in
status — the visible prompt to choose `committed` or `hidden`, never silently swallowed.

**Worktree seeding — no links.** A fresh session worktree is fed by three transports, and the KIND decides
the transport: tracked data arrives by GIT CHECKOUT; renders are DERIVED and travel by RE-RENDER
(creation-time materialize + the dispatch gate); the machine snapshot (`spexcode.local.json`) is COPIED.
The rule this encodes: symlink vs copy is a WRITE-SEMANTICS declaration — write-through vs snapshot — and a
render is a third thing, a derivative, neither linked nor copied. The copy is a snapshot on purpose: a
worker's config writes die with its worktree (a worker once wiped the host's launchers through the old
link, 401ing every later dispatch). What seeding makes git-visible it hides in the shared
`.git/info/exclude` — idempotent, self-healing, no force-add bait.

**untrack-private, retired (historical note).** The old private mode untracked `.spec` + `spexcode.json`
(exclude entries + a printed `git rm --cached` recipe), and worktrees received the spec tree by SYMLINK — a
spec write from a worktree landed directly on the main tree, bypassing the branch/merge ritual. All of it
is gone: data is always tracked, spec changes travel through branches and review again (closing that
governance back door is a dividend, not a cost), and materialize never prints an untrack recipe. The
reverse migration is one move — `git add .spec spexcode.json`, commit — with the honest WARN that tracking
is not retroactive secrecy: history already pushed cannot be recalled.

**Boundaries + deferred ledger.** Remote history cannot be forgotten by any local mechanism. Double
delivery (a worktree CLAUDE.md and the main checkout's both discovered → the block twice) is [[doctor]]'s
audit, not a render mode. Deferred: the lane (story 1), the readings store (story 10), JSON mixed content
([[content-filter]]'s designed successor), the inspect/scaffold wizard (story 22).
