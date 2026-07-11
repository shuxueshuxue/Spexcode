---
title: spec-local
status: pending
hue: 200
desc: A private overlay spec root — .spec-local/, its own git repo, never on the shared remote — personal nodes get the full experience (dashboard, history, freshness) while staying unsayable into the public tree.
---
# spec-local

## raw source

The maintainer's need: some spec-grade content — ops notes, private plans — should be visible to the
local agent and on the dashboard, but never reach the shared (open-source) remote. Both naive shapes
fail. A per-node `private: true` frontmatter bit cannot change a file's git home — the file is either
tracked (then the secret is in pushed history, not private) or untracked (then nothing works) — and one
`git add -A` commits the flagged file into irrecoverable public history; the guard would have to be a
scanner, not physics. A bare gitignore keeps the secret but loses everything git provides — no versions,
no history tabs, no freshness anchor, not even a backup: the most private content becomes the only
unprotected content in the project. That is the retired untrack-private mode re-arriving without its
tooling ([[render-policy]]'s retirement note).

The resolution follows render-policy's own slogan, track ≠ push: privacy is a question of WHICH GIT HOME
holds the data, never of whether the data is in git. So the shape is a second spec root — `.spec-local/`
beside `.spec/`, ignored by the shared repo, itself a standalone git repository (pushable to a personal
private remote if the owner wants off-machine backup). Every mechanism that makes spec data first-class —
version = git log, the history/diff tabs, drift, reading anchors — runs unchanged against the private
root's own repo; the union of the two roots happens once, at load. Granularity is per-node either way:
what this design refuses is not fine-grained privacy but the bit-flip *representation* of it.

## expanded spec (design — no code yet)

- **Grafting, not a second tree.** Paths under the private root mirror the main tree, so each private
  node grafts into the ONE tree at its intended parent. The board renders one tree; a node's privacy is
  DERIVED from which root holds it (surfaced as a badge), never declared in frontmatter — "a private
  node tracked publicly" stays unsayable, the same vocabulary-as-guardrail as the render axis. An id
  collision across roots is a lint error: one node, one home. The public tree stays self-consistent for
  everyone else; private nodes exist only where their root does.
- **Git routing.** The git layer resolves the repo per root; a private node's versions, history, and
  drift anchor in the private repo. A reading's code anchor still names the MAIN repo's HEAD — that is
  where governed code lives, and a sha is just a name; cross-repo naming is honest.
- **The ignore entry rides the managed block**, so its home follows the render vote like every other
  rule — no second mechanism. The dir name is a fixed convention (the `*.local` family, like
  `spexcode.local.json`), so the committed rule leaks nothing personal.
- **Commits are direct.** The branch/merge ritual governs SHARED intent; a single-person tree needs no
  proposal gate. An auto-commit affordance can come later.
- **CI blindness is free.** A CI clone never contains the private root, so private coverage claims and
  private nodes simply do not exist there — no per-mode branch anywhere in lint or loader.
- **Switching is migration, honestly.** private→public = move the node dir into `.spec/` and commit;
  public→private is the reverse, carrying render-policy's standing WARN that pushed history cannot be
  recalled. No bit pretends this is reversible.
- **Outside the session lifecycle, by design.** A session is bound to a node by NAME only ([[launch]]'s
  node-binding is metadata — branch naming and attribution; no machinery ever feeds spec content to a
  session), so there is nothing to guard: a worktree simply does not contain the private root, and that
  absence is the contract, not a gap. Private nodes are edited by an agent in the TRUNK checkout,
  committed directly to the private repo — never through a worker's branch/merge pipeline. The honest
  leak surfaces are the same as for any agent-readable local file (the launcher's model API, an agent
  copying content into a public file), and no repo mechanism can close those; what git physics does
  close is the merge channel: an excluded path is unstageable, so a worker's branch carries zero
  private bytes.
- **Deferred:** materializing private `surface:` config nodes; a seeding affordance that plants the
  dir, its separate-gitdir init, and the ignore entry in one step.

Until built, the owner's interim posture is the design's poor-man's version: exclude a dir per-clone
and `git init` inside it — backup-history without dashboard-history.
