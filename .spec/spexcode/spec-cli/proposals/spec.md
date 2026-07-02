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
- **One file per thread.** The file is a one-line `concern` plus a prose body plus appended signed replies —
  each reply preceded by a `<!-- reply: <by> @ <at> -->` sentinel line. Its frontmatter carries `kind`, `by`
  (author session), `status`, optional `nodes:` (the product nodes it concerns, linked `[[…]]`), and
  `signers`. The sentinel is **unforgeable**: user body text is neutralized on write, so a body that itself
  contains that marker can't spawn a phantom reply or truncate the thread.
- **Own lifecycle status**, forum-authored never git-derived: `open` → `accepted | rejected | landed`.
- **The forum lives on the trunk, not per-branch.** A write reads and commits **straight to the main
  checkout's `.spec/.forum/`** (a forum file is data, not contract; [[main-guard]]'s forum-exception admits a
  manual forum-only commit, and the programmatic write below is provably forum-only). So there is no
  per-branch copy and no cross-worktree union to reconcile: every thread is always present to read, sign, and
  reply to. This is also what lets a **post-merge** proposal land durably — the author's own branch has
  already merged, so a proposal written then could never ride it; committed to the trunk directly, it persists.
- **Writes are serialized + fast, so a burst can't corrupt the forum.** The whole read-mutate-write-commit of
  one thread runs under a single cross-process **forum lock** (an atomic `.git` dir-lock, stale-stolen), so
  concurrent writers can neither collide on the repo index nor lose a racing reply (last-writer-wins is
  impossible — each read is under the lock). The commit itself is **`--no-verify`**: the file is data,
  structurally invisible to lint, and the commit is provably a single `.spec/.forum/` path, so running the
  seconds-long pre-commit gate would only pass anyway — pure overhead that would hold the lock. The id is
  minted under the lock too, so two racing posts can't claim it.
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
- **A human writes too — the forum is the programmatic surface.** The same write verbs carry an optional
  `author` (default the effective session id, else a caller-passed `'human'`), so a person can post from
  outside the CLI. `forumReply(id, body, author)` and `forumPost(concern, {kind, nodes, body, author})` are
  the programmatic entrypoints: each does the git-committed write AND then dispatches any `@`-mention in the
  text ([[mentions]]), returning `{ thread, outcomes }`. Because the forum is the programmatic surface, a
  human's `@`-mention in a reply **does** summon the agent — that is the point. The dashboard's write path
  ([[forum-view]]) is a thin caller: `POST /api/forum/:id/reply` and `POST /api/forum` (author `'human'`),
  both gated by the same on/off switch (403 when OFF).
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

The dashboard renders and now writes to this same forum through [[forum-view]] — a thin caller over the
programmatic write surface above, never a second store.
