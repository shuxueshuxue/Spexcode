---
title: render-policy
status: active
hue: 200
desc: The vote-less footprint — renders carry no facts so they are NEVER tracked; spec data always tracked, machine facts never, run residue out-of-tree; a contract file's residence is a LIVE content fact (tracked → filter, wholly-ours → exclude, user-prose → un-hidden + clean armed).
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
freshness stitches the two ends into a closed loop. The footprint model follows: the head and tail
(`.spec`, `spexcode.json`, the readings) are the ASSET and live in git like any other source; everything
else SpexCode puts in a repo is either WIRING derived from that asset or a MACHINE fact. A render is a
pure export of `spex materialize` — it carries no facts — so it is **never tracked**: the old three-word
vote (`committed | ignored | hidden`) is RETIRED and there is exactly ONE residence behavior. An
environment without the generator (a teammate's clone, CI, a cloud agent's fresh checkout) runs
`spex materialize` in its setup step; there is no committed-render delivery mode — no generator means not
using SpexCode.

## expanded spec

The four kinds, each with a FIXED track/transport fact (no votes anywhere):

- **Spec data** — `.spec/` (including `.config/`) + `spexcode.json`: ALWAYS tracked. Git is the database;
  no configuration can untrack them ("untrack the spec" is unsayable in the schema).
- **Machine facts** — `spexcode.local.json`, the hook shims (`.claude/settings.json`, `.codex/hooks.json`),
  plugin bundles (they bake this install's paths): NEVER tracked; always in the per-clone exclude.
- **Renders** — the contract blocks in CLAUDE.md/AGENTS.md and the rendered skills/agents: NEVER tracked;
  hidden via the per-clone `.git/info/exclude`. The host's tracked `.gitignore` is **never touched** — a
  legacy managed block found there is erased by the next render (the forgetting law), an honest one-time
  migration diff.
- **Run residue** — `.worktrees/`, the global store, `.git/spexcode` blobs: never tracked; out of tree, or
  exclude-ruled where in-tree.

**A contract file's residence is a live CONTENT fact, re-judged at every render** (never an install-time
choice, never a question to the user):

- *host-tracked* → the clean/smudge [[content-filter]]: index keeps the pristine host prose, the working
  tree carries prose + block, status stays clean;
- *untracked and wholly ours* (nothing left after stripping our sentinel block) → one exclude entry;
- *untracked with USER prose in it* → the exclude entry is WITHDRAWN — exclude may only hide what is 100%
  ours; hiding user content is data-loss shaped (their prose would be invisible to status, add -A, and
  every backup path) — and the clean filter is pre-armed. The file surfaces as honestly untracked (`??`);
  IF the user chooses to `git add` it, clean strips the block automatically. SpexCode never stages,
  tracks, or commits anything for the user — tracking is always their own act, and this transition makes
  that act safe by construction.

**The exclude is a citizenship declaration, not a history guard.** History is guarded by the pre-commit
surgery ([[commit-surgery]]); the ignored-bit is what every OTHER git door consults — checkout may
silently overwrite an ignored file (an unignored untracked one hard-fails a branch switch), `git clean
-fd` spares it (an unexcluded `spexcode.local.json` was once wiped by routine cleanup, 401-ing every later
dispatch), and status/`add -A`/stash/IDE panes stay silent. The two mechanisms cover git's two disjoint
domains: filters exist only on the tracked-content pipeline; the untracked namespace's only masking
primitive is the ignore family. Neither can replace the other.

**Worktree seeding — no links.** A fresh session worktree is fed by three transports, and the KIND decides
the transport: tracked data arrives by GIT CHECKOUT; renders are DERIVED and travel by RE-RENDER
(creation-time materialize + the git-native anchors); the machine snapshot (`spexcode.local.json`) is
COPIED. Symlink vs copy is a WRITE-SEMANTICS declaration — write-through vs snapshot — and a render is a
third thing, a derivative, neither linked nor copied. The copy is a snapshot on purpose: a worker's config
writes die with its worktree (a worker once wiped the host's launchers through the old link). What seeding
makes git-visible it hides in the shared `.git/info/exclude` — idempotent, self-healing, no force-add bait.

**Retirement ledger (historical).** The `render` vote and its whole apparatus — `spex init --render`, the
open-vote decision hint, the per-mode migration matrix, the `.gitignore` managed block, `private: true` as
a hidden-alias — are gone; a lingering `render`/`private` field is ignored with a loud non-fatal notice
naming the removal recipe. The older untrack-private mode (untracked `.spec`, worktree symlinks) died
earlier for governance reasons. What the vote's `committed` word used to buy — delivery to clones without
the generator — is deliberately dropped as a requirement: those environments run `spex materialize` in
setup. Deferred lanes that survive unchanged: the readings store move (evidence blobs already live in
`.git/spexcode`), the same-repo orphan-ref guest lane, and the private per-node successor now designed as
[[spec-local]] — a private overlay root that is its OWN git home, so the data stays in git, just never in
the shared one (track ≠ push holds; "untrack the spec" stays unsayable).
