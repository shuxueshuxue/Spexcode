---
title: commit-surgery
status: active
hue: 200
desc: The git-native anchors of the footprint — pre-commit runs an UNCONDITIONAL materialize + staged-index repair (strip leaked blocks in place, evict HEAD-untracked artifacts; never reject), post-checkout/post-merge re-materialize; no harness event ever triggers a materialize.
code:
  - spec-cli/src/commit-surgery.ts
related:
  - spec-cli/templates/hooks/pre-commit
  - spec-cli/templates/hooks/post-checkout
  - spec-cli/templates/hooks/post-merge
  - spec-cli/hooks/dispatch.sh
---
# commit-surgery

## raw source

"The masks must never be stale" is a temporal invariant no gate can guarantee — so it is replaced by an
EVENT-anchored one: the materialized artifacts are provably fresh at the only moments freshness matters.
History is written
at exactly one gate (commit), and a clone's materialize inputs (.spec/.config content, a contract file's
trackedness) move only through git's own transitions (commit, checkout, merge) or the user's editor. So
the anchors are git-native and ONLY git-native: the spex verbs (init/materialize), session-worktree
creation, and the planted pre-commit / post-checkout / post-merge hooks. The harness is a READER of the
materialized files, never a trigger — the old dispatch-gate auto-materialize is retired, and `.config` edits
became git-transactional: they take effect at the commit/checkout/merge that carries them, like any other
source change.

## expanded spec

**pre-commit — the correctness anchor.** Two halves, in order:

1. *Unconditional materialize.* Every machine-fixable staleness (exclude entries, filter binding, a
   contract file's kind flip) is repaired before the index is inspected. Unconditional is affordable
   precisely because of the vote's collapse: materialize's write surface is untracked artifacts + per-clone
   config — ZERO tracked-file touches — so running it inside a hook can neither dirty the commit nor need
   to amend it.
2. *Staged-index surgery — repair, never reject.* Over staged ∩ artifact paths, by kind: a contract blob
   carrying our sentinel block is cleaned IN PLACE (source = the STAGED BLOB, never the worktree — `git
   add -p` partial staging survives byte-for-byte; only the block is removed); a HEAD-untracked
   machine/run-residue/generated artifact is EVICTED (its tracked contribution is zero bytes — an empty
   husk is worse than absence; the file stays on disk); anything HEAD already tracks is never deleted by a
   hook — a legacy committed artifact heals via the block-strip, converging history toward pristine without
   a surprise deletion. Both operations carry zero intent ambiguity (the block's content is never the
   user's; a wholly-ours file holds no user byte), so there is no question to ask and no rejection — one
   stderr note per repair, and the commit proceeds.

The surgery deliberately INVERTS the hook-env rule the rest of the hook chain lives by: it PRESERVES
`GIT_INDEX_FILE` so the exact index this commit is built from — including the TEMPORARY index of a
pathspec or `-a` commit — is the one read and repaired (git.ts's `git()` strips that env for repo
discovery; index surgery is the one place the env is the point). Resolution and failure are advisory like
the lint shim: no CLI → skipped with a note, CI lint stays the enforcement gate; and the guard travels
with the risk — the artifacts and the hook are planted by the same materialize, so any clone that can leak
necessarily carries the repair.

**post-checkout / post-merge — the freshness anchors.** A branch checkout can flip a contract file's
trackedness (switching to a branch that tracks CLAUDE.md checks out the pristine index prose): the
post-checkout re-materialize writes the block back into the working file, binds the filter, and withdraws the
exclude entry — the kind transition heals itself; file checkouts (flag 0) are skipped. post-merge
re-materializes after received `.spec`/`.config` changes. Both are quiet and best-effort: a missed refresh
self-heals at the next anchor, pre-commit being the backstop.

**Known self-hosting residue.** The hook resolves `spex` PATH-first, so on a branch that CHANGES
materialize's own semantics the commit anchor still runs the OLD toolchain until the deployed
global/hook copies update — a stale toolchain's materialize can momentarily overwrite a new one at commit
frequency
(down from the retired gate's every-event frequency; visible in git status, self-healing at the next
current-toolchain anchor, never blocking). The remedy is operational, not mechanical: ship + update
the global right after such a branch merges.

**The friction budget this buys.** Worst full path: the user edits a wholly-ours contract file, `git add`
hits git's own ignored-path refusal (ONE bump — git's message, git's `-f` answer), forces, commits — and
the surgery makes that native escape hatch safe. One bump is the floor under git physics (add has no hook;
a pure materialized artifact must stay excluded or `??` noise and empty-file scooping return). Every other
path — an
anchor ran between edit and add — is zero-bump.
