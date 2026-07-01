---
title: proposals
status: active
hue: 200
desc: An async FORUM — the git-native discussion/annotation layer over the graph. Threads (kind proposal | note) are plain documents under .spec/.forum (NOT spec nodes); others sign/reply; a supervisor drains it. Proposals are nudged post-merge, once the agent's own work has safely landed.
code:
  - spec-cli/src/proposals.ts
  - spec-cli/templates/hooks/post-merge
---

# proposals

## raw source

An agent finishing a task notices things that feel off — a smell, an awkward boundary, a wish — often
unrelated to its mainline. That judgment is **taste**, and it must not evaporate when the session ends. So a
finished session records such concerns into one shared, durable **forum**; other sessions sign and discuss
them like an async chatroom; a supervisor later drains the forum into real work. This keeps **global** taste
flowing into the codebase's shape, instead of every agent owning only its own slice.

## expanded spec

The forum is **git-tracked data, not a spec node.** A thread reuses almost nothing of the spec-node
contract — no title/hue/desc/code frontmatter, no parent-ancestor nesting, no lint, no drift, no
version-from-`spec.md`-log, no graph render — so forcing it into a `spec.md` would only earn it a pair of
graph-exemptions to blind it again. Instead each thread is a **plain markdown file** at
`<root>/.spec/.forum/<id>.md`. Because that file is **not named `spec.md`**, the spec walk descends past
it without making a node and `isSpecMd` ignores it: the forum is invisible to lint / drift / deriveStatus /
overlay **structurally**, with no special-case exemption. It lives **inside `.spec`** (not a second
top-level folder) so adopting SpexCode still adds one directory — matching how the reflexive `.config`
system already nests there.

- **Two thread kinds, one mechanism.** A `kind` frontmatter field distinguishes a **`proposal`** (taste that
  wants change — the post-merge-recorded concern) from a **`note`** (a durable annotation / heads-up / Q&A on
  a node, no change-intent — the thing that has no home in a spec body, which is contract, or a code comment,
  which is about what code does). Same store, same file format, same `reply`/`sign`/`resolve` verbs (those
  are id-based and kind-agnostic); only the creation verb carries the kind (`spex propose` vs `spex note`).
  The forum is the git-native **discussion/annotation layer over the graph**; a proposal is one kind of post.
- **One file per thread.** The file is a one-line `concern` plus a prose body plus appended signed replies;
  its frontmatter carries `kind`, `by` (author session), `status`, optional `nodes:` (the product nodes it
  concerns, linked `[[…]]`), and `signers`. One-file-per-thread keeps concurrent worktrees conflict-free: a
  new thread is a new file (never conflicts); a reply touches one file.
- **Own lifecycle status**, forum-authored never git-derived: `open` → `accepted | rejected | landed`.
- **The forum lives on the trunk, not per-branch.** A write reads and commits **straight to the main
  checkout's `.spec/.forum/`** — [[main-guard]] admits a commit touching only forum files, because the
  forum is data, not contract, and needs no review ritual. So there is no per-branch copy and no
  cross-worktree union to reconcile: every thread is always present to read, sign, and reply to. This is
  also what lets a **post-merge** proposal land durably — the author's own branch has already merged, so a
  proposal written then could never ride it; committed to the trunk directly, it simply persists.
- **Nudged AFTER the work lands, not during it.** The agent's own task is what matters most, so the forum is
  never raised while it is still finishing — it is raised the moment the work **merges**. A **`post-merge`
  git hook** (harness-side gates live in [[state]]; this one is git-side) fires in the doer's dispatched
  merge turn — merge is dispatched to the session's own agent (see [[dispatch]]) — guarded to the
  `merge node/<id>:` commit so an ordinary pull never nags; its nudge lands in the agent's own command
  output: read the forum, sign/reply if the concern is already raised, else open a new one. Git-native, so
  it reaches a self-launched agent too and costs no harness block-cap.
- **Surface:** `spex propose "<concern>" [--node <id>…] [--body -|<text>]` and `spex note "<annotation>" …`
  open the two kinds; `propose reply|sign|resolve <id>` act on any thread; `spex proposals [--node]
  [--kind proposal|note] [--all] [--json]` is the drain view over the whole forum.
- **Opt-outable, default ON.** The whole forum is a feature you can switch off: `spex proposals on|off`
  flips `spexcode.json`'s `proposals.enabled` (the shared settings file every other toggle lives in),
  effective immediately with no commit (config is read from the working tree). OFF silences the post-merge
  nudge and hides the dashboard forum view; the raw `propose`/`proposals` commands stay usable, since running
  one is explicit consent. The nudge text and the toggle both live in the CLI (`spex propose nudge <node>`
  prints nothing when OFF), so the post-merge hook is a thin caller and the **dashboard's Settings toggle is
  a thin wrapper over this same switch** — one source of truth, three consumers (CLI, hook, dashboard).
- **Dedup is the drain's job, not the write's.** Duplicate proposals are a **signal** (recurrence), folded
  into one thread by a supervisor's judgment ([[supervisor]]) — never a write-time similarity match. And
  recurrence is weighed as **salience, not importance**: a sharp singleton outranks a popular gripe, so the
  count never becomes the priority ranking.

Out of scope (a sibling node, later): a dashboard forum view — read-only over this same union read.
