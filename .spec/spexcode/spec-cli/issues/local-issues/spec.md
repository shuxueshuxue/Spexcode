---
title: local-issues
status: active
hue: 200
desc: The LOCAL store of the one Issue object ([[issues]]): git-native threads as plain documents under .spec/.issues (NOT spec nodes); others sign/reply; a supervisor drains it. Opening one is nudged post-merge, once the agent's own work has safely landed; closing yours is nudged at propose-close.
code:
  - spec-cli/src/localIssues.ts
  - spec-cli/templates/hooks/post-merge
---

# local-issues

## raw source

An agent finishing a task notices things that feel off — a smell, an awkward boundary, a wish — often
unrelated to its mainline. That judgment is **taste**, and it must not evaporate when the session ends. So a
finished session records such concerns into one shared, durable **local issue store**; other sessions sign and discuss
them like an async chatroom; a supervisor later drains the local issue store into real work. This keeps **global** taste
flowing into the codebase's shape, instead of every agent owning only its own slice.

**The local issue store is narrow on purpose — it is not an issue tracker.** A local issue earns its place only when it
will **outlive the task at hand**, in one of exactly two shapes: (a) an off-mainline **taste concern** —
something you are *not* going to act on now; or (b) a **not-worth-a-spec to-do** — something
trivial-but-must-not-be-forgotten that doesn't merit a spec node. That's it. It is deliberately **not** a
general bug tracker: tracking work is what the **spec graph** (the definition) and the **forge** (the
execution) already do, and a store that competes with them stops being a durable taste-layer and becomes a
second, drifting source of truth — a liability. Two anti-patterns follow directly: **don't open an issue for
a task you're actively driving** — you'll do it and then forget the thread; the design of dispatched work
rides its dispatch, not a lingering issue. And **close what you finish** — an issue whose work has landed is
resolved (`landed`/`accepted`), never left open; the open set is the *outstanding* work, so a stale open is a
lie the drain has to re-triage. The post-merge nudge fires at exactly the moment both disciplines apply (you
just landed work), and states them.

## expanded spec

The local issue store is the **local store of [[issues]]** — the venue where a locally-stored Issue lives. A thread
*is* an Issue whose `store` is `local`; that store membership is implied by **where the file lives**,
never written into it. Local and remote issues are the SAME data model under the SAME name — an issue — so
this node owns only the local store's mechanism: the venue, the file format, the write
verbs, the concurrency discipline, and the post-merge nudge. Reading is not this node's surface — the one
read over every store (CLI `spex issues`, `GET /api/issues`, the board fold) is [[issues]]'s port.

The local issue store is **git-tracked data, not a spec node.** A thread reuses almost nothing of the spec-node
contract — no title/hue/desc/code frontmatter, no parent-ancestor nesting, no lint, no drift, no
version-from-`spec.md`-log, no graph render — so forcing it into a `spec.md` would only earn it a pair of
graph-exemptions to blind it again. Instead each thread is a **plain markdown file** at
`<root>/.spec/.issues/<id>.md`. Because that file is **not named `spec.md`**, the spec walk descends past
it without making a node and `isSpecMd` ignores it: the local issue store is invisible to lint / drift / deriveStatus /
overlay **structurally**, with no special-case exemption. It lives **inside `.spec`** (not a second
top-level folder) so adopting SpexCode still adds one directory — matching how the reflexive `.config`
system already nests there. (The dir was historically `.spec/.forum`; a pre-rename deployment self-migrates
it to `.spec/.issues` on its first store touch after a toolchain update — the one-shot mechanism is
[[issues-store-rename]].)

- **One kind of thread — the prose says what it is.** A change suggestion, a durable annotation, a heads-up,
  a Q&A: all the same mechanism, distinguished by nothing but their own words. There is deliberately no
  `kind` taxonomy field ([[issues]]): it would do no mechanical work — the verbs are id-based, dispatch
  doesn't branch on it, the drain is judgment — so it would be a label bought with a second creation verb
  and a filter. The local issue store is the git-native **discussion/annotation layer over the graph**.
- **One file per thread.** The file is a one-line `concern` plus a prose body plus appended signed replies —
  each reply preceded by a `<!-- reply: <by> @ <at> -->` sentinel line. A reply may carry **remark** state
  ([[remark-substrate]]) — a resolvable bit + the codeSha it judges — appended to its sentinel as a
  ` :: <k=v>` tail; a plain reply has no tail and parses unchanged, and the remark write verbs
  (`remark`/`resolve`/`retract`) are thin siblings of `reply` over this same committed store. Its frontmatter carries `by`
  (author session), `status`, optional `nodes:` (the product nodes it concerns, linked `[[…]]`), optional
  `evidence:` (yatsu content-addressed blob hashes — the typed reference a cross-node finding carries, per
  [[issues]] / [[video-evidence]]), and `signers`. The sentinel is **unforgeable**: user body text is
  neutralized on write, so a body that itself contains that marker can't spawn a phantom reply or truncate
  the thread.
- **Own lifecycle status**, store-authored never git-derived: `open` → `accepted | rejected | landed`.
- **The local issue store lives on the trunk, not per-branch.** A write reads and commits **straight to the main
  checkout's `.spec/.issues/`** — a local-issue file is data, not contract, and the write below commits it with
  `--no-verify` (provably a single `.spec/.issues/` path), so it lands on the trunk without needing any
  [[main-guard]] exception. So there is no per-branch copy and no cross-worktree union to reconcile: every
  thread is always present to read, sign, and reply to. This is also what lets a **post-merge** concern
  land durably — the author's own branch has
  already merged, so an issue opened then could never ride it; committed to the trunk directly, it persists.
- **Only the trunk checkout may commit that write — a linked-worktree backend must not fabricate commits on a
  main it doesn't own.** Because *every* backend resolves the store to `dirname(git-common-dir)` (the shared main),
  a backend serving a linked worktree — a dev worktree's `spex serve`, a dispatched **e2e** rig — would otherwise
  `git commit` a stray issue onto the **real, live** main working tree: advancing it under whoever is there and
  racing its `index.lock`. Trunk-scoping is right and stays (issues are not code-bound, so they belong on the one
  always-visible store); the bug was never *where* issues live, only *which* checkout's git got the commit. So the
  write is gated by one deterministic predicate — `repoRoot() === mainCheckout()`, i.e. this process's own root
  IS the trunk checkout. True for the primary backend and for a throwaway **clone** (its own `.git`, its own
  disposable main — never the real one); **false only for a linked-worktree backend**, exactly the footgun. When
  false the commit is **refused, loud, with the repair** — never a silent write onto someone else's main. The
  legitimate write moment already satisfies the predicate: the post-merge nudge fires inside `git -C <main> merge`
  (cwd = main), so a doer opening a post-merge concern is running as the trunk checkout.
- **A disposable store for tests — one override, plain files, no commit, no git at all.** `SPEXCODE_ISSUES_DIR=<abs>`
  points **both** reads and writes at an isolated directory of plain `.md` files: no `git add/commit`, so it can
  **never** touch any shared main, and the primary-checkout predicate is moot (nothing is committed). This is the
  e2e/sandbox seam — a test rig sets it once and exercises the whole open/reply/remark surface against a temp dir
  it throws away, mirroring how [[blob-put]]'s evidence cache and `SPEXCODE_HOME` keep test artifacts off the repo.
  (Refuse-when-non-primary is the minimum honest fix that stops the dirtying today; the fuller ambition — a
  *worktree-independent* commit that lands the write on trunk from ANY checkout without a working-tree touch, e.g.
  `hash-object`+`commit-tree`+`update-ref` — is deferred: advancing the checked-out trunk **branch** ref leaves its
  working tree showing phantom deletions, and a dedicated non-branch ref would forfeit working-tree visibility and
  normal push/pull sync, so it is a redesign of the read side too, not this node's mechanism patch.)
- **Writes are serialized + fast, so a burst can't corrupt the local issue store.** The whole read-mutate-write-commit of
  one thread runs under a single cross-process **store lock** (an atomic `.git` dir-lock, stale-stolen), so
  concurrent writers can neither collide on the repo index nor lose a racing reply (last-writer-wins is
  impossible — each read is under the lock). The commit itself is **`--no-verify`**: the file is data,
  structurally invisible to lint, and the commit is provably a single `.spec/.issues/` path, so running the
  seconds-long pre-commit gate would only pass anyway — pure overhead that would hold the lock. The id is
  minted under the lock too, so two racing posts can't claim it. And a **no-change write is idempotent
  success**: when the requested state already IS the stored state (a duplicate resolve, a repeat sign), the
  write detects the no-op after staging and skips the commit — the verb reports "already <state>" and exits
  0, never surfacing git's nothing-to-commit failure as an error for a store that is exactly as asked.
- **Nudged AFTER the work lands, not during it.** The agent's own task is what matters most, so the local issue store is
  never raised while it is still finishing — it is raised the moment the work **merges**. A **`post-merge`
  git hook** (harness-side gates live in [[state]]; this one is git-side) fires in the doer's dispatched
  merge turn — merge is dispatched to the session's own agent (see [[dispatch]]) — guarded to the
  `merge node/<id>:` commit so an ordinary pull never nags; its nudge lands in the agent's own command
  output: read the issues, sign/reply if the concern is already raised, else open a new one. Git-native, so
  it reaches a self-launched agent too and costs no harness block-cap.
- **Nudged again at close — the session's issue closeout.** The post-merge nudge fires when work lands; a
  second, **data-driven** nudge fires when the session proposes **close** — appended to the
  `done --propose close` declaration beside [[state]]'s resource-cleanup reminder, the same insertion point
  and the same semantics. `closeoutNudge(sessionId)` lists the **still-open local threads that session
  touched** (authored or replied — eval `eval: <node> · <scenario>` remark containers excluded, they outlive
  every session by design), asking for each: resolve it now if its work is finished, or reply why it should
  stay open past this session. Empty set, feature OFF, or no session identity → it prints **nothing**, so a
  declaration never carries a vacuous reminder — the line is earned by data, never boilerplate. And it is a
  **nudge, never a gate**: some issues rightly outlive their session (a taste concern awaiting the drain),
  and a failure in the store check is reported loud while the declaration still lands.
- **Surface — the write verbs live on the ONE issues command.** `spex issues open "<concern>" [--node <id>…]
  [--evidence <hash>…] [--body -|<text>]` opens a thread; `spex issues reply <id> --body -|<text>
  [--evidence <hash>…]` (the evidence a reply carries accrues onto the thread's `evidence[]`, deduped — an
  anchored annotation's frame blob), `sign`, and `resolve` act on any local thread. A new thread's `nodes:`
  are **inferred from the `[[node]]` topic links in its own text** (concern + body, [[mentions]]'s one
  in-text reference primitive), unioned with any explicit `--node` — a writer links nodes by writing them,
  so no caller needs a separate ids field. Read and write share one
  command because local and remote are one model — the store is a property of the issue, never a second
  command family. There is deliberately no store-local read command — reading is `spex issues` ([[issues]]),
  the same list every store feeds. (The write verbs were historically a separate `spex propose` command;
  that alias is now removed — the top level is porcelain-only ([[cli-surface]]). A pre-rename deployment's
  `post-merge` hook — a per-clone copy calling `spex propose nudge` — prints one unknown-command line,
  advisory only, until `npm run hooks` reinstalls it.)
- **A human writes too — the local issue store is the programmatic surface.** The same write verbs carry an optional
  `author` (default the effective session id, else a caller-passed `'human'`), so a person can post from
  outside the CLI. `replyLocalIssue(id, body, author)` and `postLocalIssue(concern, {nodes, body, author})` are
  the programmatic entrypoints: each does the git-committed write AND then dispatches any `@`-mention in the
  text ([[mentions]]). `replyLocalIssue` additionally loops in the thread's **originator** — its author, or, for an
  eval-comment thread (concern `eval: <node> · <scenario>`), the reading's filer — as a courtesy if online
  (the implicit loop-in, [[mentions]]); `postLocalIssue` opens a *new* thread whose originator is the poster, so it
  loops in no one. Each returns `{ thread, outcomes, loopIn }`. Because the local issue store is the programmatic surface, a
  human's `@`-mention in a reply **does** summon the agent — that is the point. The dashboard's write path
  ([[issues-view]]) is a thin caller: `POST /api/issues/:id/reply` and `POST /api/issues` (author `'human'`),
  both gated by the same on/off switch (403 when OFF).
- **Opt-outable, default ON.** The issues workflow is a feature you can switch off: `spex issues on|off`
  flips `spexcode.json`'s `issues.enabled` (the shared settings file every other toggle lives in),
  effective immediately with no commit (config is read from the working tree). OFF silences the post-merge
  nudge and hides the dashboard issues view; the raw write verbs stay usable, since running one is explicit
  consent. The nudge text and the toggle both live in the CLI (`spex issues nudge <node>` prints nothing
  when OFF), so the post-merge hook is a thin caller and the **dashboard's Settings toggle is a thin
  wrapper over this same switch** — one source of truth, three consumers (CLI, hook, dashboard). (The key
  was historically `proposals.enabled`; a pre-rename value still reads, and the next toggle write rewrites
  it under `issues` — self-heal on touch, like the store-dir rename.)
- **Dedup is the drain's job, not the write's.** A duplicate concern is a **signal** (recurrence), folded
  into one thread by a supervisor's judgment ([[supervisor]]) — never a write-time similarity match. And
  recurrence is weighed as **salience, not importance**: a sharp singleton outranks a popular gripe, so the
  count never becomes the priority ranking.

The dashboard renders and writes to this same store through [[issues-view]] — a thin caller over the
programmatic write surface above, never a second store.
