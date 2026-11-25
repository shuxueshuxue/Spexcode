---
title: local-issues
status: active
hue: 200
desc: The LOCAL store of the one Issue object ([[issues]]): git-native threads as plain documents under .spec/.issues (NOT spec nodes); others reply; a supervisor drains it. Opening one is nudged post-merge, once the agent's own work has safely landed; closing yours is nudged at propose-close.
code:
  - spec-cli/src/localIssues.ts
related:
  - spec-cli/templates/hooks/post-merge
  - spec-cli/src/localIssues-git.test.ts
---

# local-issues

## raw source

An agent finishing a task notices things that feel off — a smell, an awkward boundary, a wish — often
unrelated to its mainline. That judgment is **taste**, and it must not evaporate when the session ends. So a
finished session records such concerns into one shared, durable **local issue store**; other sessions discuss
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
`landed`, never left open; the open set is the *outstanding* work, so a stale open is a
lie the drain has to re-triage. The post-merge nudge fires at exactly the moment both disciplines apply (you
just landed work), and states them.

## expanded spec

The local issue store is the **local store of [[issues]]** — the venue where a locally-stored Issue lives. A thread
*is* an Issue whose `store` is `local`; that store membership is implied by **where the file lives**,
never written into it. Local and remote issues are the SAME data model under the SAME name — an issue — so
this node owns only the local store's mechanism: the venue, the file format, the write
verbs, the concurrency discipline, and the post-merge nudge. Reading is not this node's surface — the one
read over every store (CLI `spex issue ls`, `GET /api/issues`, the board fold) is [[issues]]'s port.

The local issue store is **git-tracked data, not a spec node.** A thread reuses almost nothing of the spec-node
contract — no title/hue/desc/code frontmatter, no parent-ancestor nesting, no lint, no drift, no
version-from-`spec.md`-log, no graph render — so forcing it into a `spec.md` would only earn it a pair of
graph-exemptions to blind it again. Instead each thread is a **plain markdown file** at
`<root>/.spec/.issues/<id>.md`. Because that file is **not named `spec.md`**, the spec walk descends past
it without making a node and `isSpecMd` ignores it: the local issue store is invisible to lint / drift / deriveStatus /
overlay **structurally**, with no special-case exemption. It lives **inside `.spec`** (not a second
top-level folder) so adopting SpexCode still adds one directory — matching how the reflexive `.plugins`
system already nests there. (The dir was historically `.spec/.forum`; a pre-rename deployment self-migrates
it to `.spec/.issues` on its first store touch after a toolchain update — the one-shot mechanism is
[[issues-store-rename]].)

- **One kind of thread — the prose says what it is.** A change suggestion, a durable annotation, a heads-up,
  a Q&A: all the same mechanism, distinguished by nothing but their own words. There is deliberately no
  `kind` taxonomy field ([[issues]]): it would do no mechanical work — the verbs are id-based, dispatch
  doesn't branch on it, the drain is judgment — so it would be a label bought with a second creation verb
  and a filter. The local issue store is the git-native **discussion/annotation layer over the graph**.
- **One file per thread.** The file is a one-line `concern` plus a prose body plus appended replies —
  each reply preceded by a `<!-- reply: <by> @ <at> -->` sentinel line. That sentinel is the reply's whole
  header — a reply is author, instant and prose, nothing else. A sentinel carrying a trailing ` :: <attrs>`
  tail (a shape older toolchains wrote) still parses as that same plain reply: the tail is ignored on read
  and dropped by the file's next rewrite, so no deployment's store needs a migration and no record ever
  fails to load. `reply` is the store's only way a post enters a thread. Its frontmatter carries `by`
  (author session), `status`, `created`, `closedAt:` once the thread has closed (below), optional `nodes:` (the product nodes it concerns, linked `[[…]]`), optional
  `evidence:` (content-addressed evidence hashes — the typed reference a cross-node finding carries, per
  [[issues]] / video evidence), and the optional hierarchy facts `parent:` and `relations:` (below). The sentinel is **unforgeable**: user body text is
  neutralized on write, so a body that itself contains that marker can't spawn a phantom reply or truncate
  the thread.
- **An id is the concern's own words, in any script.** The file name a thread is minted under is its concern,
  NFC-normalized and lowercased, with every run of characters that is not a unicode letter, number, or combining
  mark folded to
  one `-`, trimmed, and cut at 48 code points (never mid-character). Those are exactly the characters
  [[spec-lint]]'s id-format and a [[mentions]] `[[id]]` link already accept, so a concern written in Chinese,
  Greek, Hindi, Thai, or any other script keeps a readable, linkable address instead of collapsing to a placeholder. Only a
  concern with no letter or number at all mints `issue`. Collisions and the reserved address words take a
  numeric suffix under the store lock (below).
- **Own lifecycle status**, store-authored never git-derived: current writes have one terminal state, `open` →
  `landed`. A legacy terminal `rejected` value is preserved as a distinct closed reading, so "we decided not
  to" is never rendered as "it shipped" and never reappears in the open drain.
- **The close instant is stored beside the status — one timestamp, not a state.** The write that moves a thread out
  of `open` also writes `closedAt: <iso>` into its frontmatter: a plain `close`, a `close --duplicate-of`, and the
  close that finishes a promote all go through that one write. It is the [[issues]] `closedAt` a reader places a
  close by; nothing branches on it. A close of a thread that is already closed keeps the first instant, so a repeat
  close stays the idempotent no-op below and never moves the recorded moment. **Migration: none on disk.** A thread
  closed before the key existed has no `closedAt:` line and reads `closedAt: null`; the store never backfills it or
  invents an instant, and the file keeps its exact bytes — a later rewrite of it (a reply) still writes no
  `closedAt:` line, because a null serializes to none. An open thread has no line either.
- **A sub-issue and a relation are forward facts, stored once.** A thread's frontmatter may carry `parent: <id>` —
  its DIRECT parent only — and `relations: <type>:<id>, …` on the issue that INITIATED each edge (`blocks`,
  `related`, `duplicate`). Nothing is written onto the parent or the target, and a thread with neither key keeps
  its exact bytes: children, reverse edges, child counts and the closed-blocker downgrade are rebuilt on every
  merged read by [[issues]]'s hierarchy projection, the way [[session-nesting]] rebuilds the forest from `parent`
  pointers. The writes check what the store alone can check. A parent must be an existing OPEN local issue at the
  moment the pointer lands (`open --parent`, `reparent --to`) — a sub-issue is new work, and new work never hangs
  under finished work — and `reparent` walks the stored pointers up from the new parent and refuses one that
  would close a cycle; `--to none` removes the key. A sub-issue opened without its own `--node` takes its parent's
  `nodes:` as its explicit ids (its own `[[node]]` links still union in). `relate` needs an existing local target
  other than the issue itself and stores each edge once. `duplicate` is not a status: `close --duplicate-of
  <canonical>` marks the thread `landed` and replaces any earlier `duplicate:` edge with the canonical in that same
  commit, whose message names it. Only local issues hold these facts — a forge issue has no frontmatter — so every
  parent and target a write accepts is a local id.
  The CLI `reparent` verb and the dashboard's `POST /api/issues/:id/reparent` call the same `reparentLocalIssue` write
  path. It accepts a local source and either an open local parent or `null`, refuses a missing/closed/forge parent and
  any ancestor cycle with the original validation message, and serializes only the source thread's existing `parent:`
  pointer. Reparenting never changes the on-disk shape or writes a reciprocal child list.
- **The local issue store lives on the trunk, not per-branch.** A write reads and commits **straight to the main
  checkout's `.spec/.issues/`** — a local-issue file is data, not contract, and the write below commits it with
  `--no-verify` (provably a single `.spec/.issues/` path), so it lands on the trunk without needing any
  [[main-guard]] exception. So there is no per-branch copy and no cross-worktree union to reconcile: every
  thread is always present to read and reply to. This is also what lets a **post-merge** concern
  land durably — the author's own branch has
  already merged, so an issue opened then could never ride it; committed to the trunk directly, it persists.
- **Only the trunk checkout may commit that write — a linked-worktree backend must not fabricate commits on a
  main it doesn't own.** Because *every* backend resolves the store to `mainCheckout()` (the shared main),
  a backend serving a linked worktree — a dev worktree's `spex serve`, a dispatched **e2e** rig — would otherwise
  `git commit` a stray issue onto the **real, live** main working tree: advancing it under whoever is there and
  racing its `index.lock`. Trunk-scoping is right and stays (issues are not code-bound, so they belong on the one
  always-visible store); the bug was never *where* issues live, only *which* checkout's git got the commit. So the
  write is gated by one deterministic predicate — `repoRoot() === mainCheckout()`, i.e. this process's own root
  IS the trunk checkout. True for the primary backend and for a throwaway **clone** (its own `.git`, its own
  disposable main — never the real one); **false only for a linked-worktree backend**, exactly the footgun. When
  false the commit is **refused before acquiring the store lock or preparing a mutation, loud, with the repair** — never a silent write onto someone else's main. A submodule's primary checkout satisfies the same predicate;
  its `.git` pointer file is not a linked-worktree identity. The
  post-merge nudge does NOT satisfy the predicate, and assuming it did was a real defect. Landing is one
  `--no-ff` merge made in a **temporary detached worktree** of the source branch, which is then fast-forwarded
  into the trunk, so the `merge node/<id>:` commit — the only subject the hook reacts to — is authored from a
  linked worktree. The nudge therefore fired where a write is refused and still printed the `issue open`
  command: the system asking for the one thing it forbids, with the refusal arriving only after the agent
  tried. The nudge now reads **this same predicate** and adapts its second instruction, so the ask and the
  enforcement cannot disagree; from the trunk it still names `issue open`, and from a linked worktree it says
  the open belongs in the declaration note or in the trunk checkout. The predicate is read in the CLI, where
  the write enforces it, never re-derived by the git hook.
- **A disposable store for tests — one override, plain files, no commit, no git at all.** `SPEXCODE_ISSUES_DIR=<abs>`
  points **both** reads and writes at an isolated directory of plain `.md` files: no `git add/commit`, so it can
  **never** touch any shared main, and the primary-checkout predicate is moot (nothing is committed). This is the
  e2e/sandbox seam — a test rig sets it once and exercises the whole open/reply surface against a temp dir
  it throws away, mirroring how [[evidence-put]]'s evidence cache and `SPEXCODE_HOME` keep test artifacts off the repo.
  (Refuse-when-non-primary is the minimum honest fix that stops the dirtying today; the fuller ambition — a
  *worktree-independent* commit that lands the write on trunk from ANY checkout without a working-tree touch, e.g.
  `hash-object`+`commit-tree`+`update-ref` — is deferred: advancing the checked-out trunk **branch** ref leaves its
  working tree showing phantom deletions, and a dedicated non-branch ref would forfeit working-tree visibility and
  normal push/pull sync, so it is a redesign of the read side too, not this node's mechanism patch.)
- **Writes are serialized + fast, so a burst can't corrupt the local issue store.** The whole read-mutate-write-commit of
  one thread runs under a single cross-process **store lock** (an atomic `spexcode-forum.lock` directory in the
  Git common directory, stale-stolen). Resolve this directory through Git, including when `.git` is a pointer
  file; preserve the lock name so old and new writers in ordinary repositories still exclude one another. Thus
  concurrent writers can neither collide on the repo index nor lose a racing reply (last-writer-wins is
  impossible — each read is under the lock). The commit itself is **`--no-verify`**: the file is data,
  structurally invisible to lint, and the commit is provably a single `.spec/.issues/` path, so running the
  seconds-long pre-commit/commit-msg gate would only pass anyway — pure overhead that would hold the lock.
  Git still runs `prepare-commit-msg`, which clears any stale candidate arm, and its ref transaction still
  reaches the installed observer; no commit-msg arm exists, so that observer returns before a history walk
  or lint. This keeps the bypass fast without teaching the gate an issue-path exception. The id is
  minted under the lock too, so two racing posts can't claim it. Minting also steps around the **reserved
  address words** — `new`, the dashboard's compose page ([[issues-view]]) — with the same numeric suffix a
  taken id gets: an id that a reader's own address grammar answers differently would be a thread nobody can
  open, so the collision is spent visibly at birth rather than discovered as a dead link. And a **no-change write is idempotent
  success**: when the requested state already IS the stored state (a duplicate close), the
  write detects the no-op after staging and skips the commit — the verb reports success and exits
  0, never surfacing git's nothing-to-commit failure as an error for a store that is exactly as asked.
  That same changed/no-op decision is **this store's own freshness carrier**: the store publishes a monotonic
  content revision that advances on exactly the writes that moved its bytes, so a reader that must not answer
  from a pre-write generation ([[review-snapshot]]) has one number to require of this store, and an idempotent
  no-op leaves nothing to wait for. The number is per store because it answers only for this store's bytes;
  merging it into a shared counter would let another store's write stand in for one of these.
- **Nudged AFTER the work lands, not during it.** The agent's own task is what matters most, so the local issue store is
  never raised while it is still finishing — it is raised the moment the work **merges**. A **`post-merge`
  git hook** (harness-side gates live in [[state]]; this one is git-side) fires in the doer's dispatched
  merge turn — merge is dispatched to the session's own agent (see [[dispatch]]) — guarded to the
  `merge node/<id>:` commit so an ordinary pull never nags; its nudge lands in the agent's own command
  output: read the issues, reply if the concern is already raised, else open a new one. Git-native, so
  it reaches a self-launched agent too and costs no harness block-cap.
- **Nudged again at close — the session's issue closeout.** The post-merge nudge fires when work lands; a
  second, **data-driven** nudge fires when the session proposes **close** — appended to the
  `done --propose close` declaration beside [[state]]'s resource-cleanup reminder, the same insertion point
  and the same semantics. `closeoutNudge(sessionId)` lists the **still-open local threads that session
  touched**, split by AUTHORSHIP because the ask differs: a thread this session **opened** is its own concern to
  retire — close it if its work is finished, or reply why it should stay open past this session; a thread
  **someone else opened** that it merely replied on is not, and it is told so — report where it stands and leave
  the close to the opener, whose judgment that is ([[issue-driven-development]]). Said as one ask each way, the
  nudge and the skill's never-close rule are the same rule; said as one ask for both, they contradicted each
  other inside the same agent's context. Empty set, feature OFF, or no session identity → it prints **nothing**, so a
  declaration never carries a vacuous reminder — the line is earned by data, never boilerplate. And it is a
  **nudge, never a gate**: some issues rightly outlive their session (a taste concern awaiting the drain),
  and a failure in the store check is reported loud while the declaration still lands.
- **Surface — the write verbs live on the ONE issues command.** `spex issue open "<concern>" [--node <id>…]
  [--evidence <hash>…] [--body -|<text>]` opens a thread (open is store-routed by [[issues]]'s creation
  port — its local default lands here; `--store <host>` bypasses this store for the forge driver);
  `spex issue reply <id> --body -|<text>
  [--evidence <hash>…]` (the evidence a reply carries accrues onto the thread's `evidence[]`, deduped — an
  anchored annotation's frame blob), and `spex issue close <id>` marks a local thread landed through
  [[issues]]'s store-routed close (`--duplicate-of <canonical>` closes it as a duplicate); `spex issue open …
  --parent <id>`, `spex issue reparent <id> --to <parent-id|none>` and `spex issue relate <id>
  blocks|related|duplicate <other-id>` write the hierarchy facts above. A new thread's `nodes:`
  are **inferred from the `[[node]]` topic links in its own text** (concern + body, [[mentions]]'s one
  in-text reference primitive), unioned with any explicit `--node` — a writer links nodes by writing them,
  so no caller needs a separate ids field. Read and write share one
  command because local and remote are one model — the store is a property of the issue, never a second
  command family. There is deliberately no store-local read command — reading is `spex issue ls` ([[issues]]),
  the same list every store feeds. (The write verbs were historically a separate `spex propose` command;
  that alias is now removed — the top level is porcelain-only ([[cli-surface]]). A pre-rename deployment's
  `post-merge` hook — a per-clone copy calling `spex propose nudge` — prints one unknown-command line,
  advisory only, until `npm run hooks` reinstalls it.)
- **A human writes too — the local issue store is the programmatic surface.** The same write verbs carry an optional
  `author` (default the effective session id, else a caller-passed `'human'`), so a person can post from
  outside the CLI. `replyLocalIssue(id, body, author)` and `postLocalIssue(concern, {nodes, body, author})` are
  the programmatic entrypoints and commit their text verbatim: an `@session` remains a passive reference, while
  an exact `@new` token dispatches only after the committed write and returns its outcome ([[mentions]]).
  `replyLocalIssue` is composed above this module with the thread originator's online courtesy loop-in;
  `postLocalIssue` opens a new thread whose originator is the poster, so it loops in no one. The
  dashboard's write path ([[issues-view]]) is a thin caller: `POST /api/issues/:id/reply` and `POST /api/issues`
  (author `'human'`), plus `POST /api/issues/:id/promote` for the local-to-forge move. All are gated by the
  same on/off switch (403 when OFF).
- **Opt-outable, default ON.** The issues workflow is a feature you can switch off: the single source of
  truth is `.spec/spexcode.json`'s `issues.enabled` (the shared settings file every other toggle lives in),
  effective immediately with no commit (config is read from the working tree). There is deliberately **no
  CLI toggle verb** (v0.3.0 — "no `spex config set`" is this project's standing rule): flip the key by
  editing the JSON; `spex doctor` reports the current state. OFF silences the post-merge
  nudge and hides the dashboard issues view; the raw write verbs stay usable, since running one is explicit
  consent. The nudge text and the switch-read both live in the CLI (`spex internal nudge <node>` prints
  nothing when OFF), so the post-merge hook is a thin caller — one source of truth, three consumers (CLI,
  hook, dashboard). (The key was historically `proposals.enabled`; that legacy key is NOT read — no
  fallback, fail toward the default — and `spex doctor` flags it so an old settings file gets repaired,
  never silently obeyed.)
- **Dedup is the drain's job, not the write's.** A duplicate concern is a **signal** (recurrence), folded
  into one thread by a supervisor's judgment ([[supervisor]]) — never a write-time similarity match. And
  recurrence is weighed as **salience, not importance**: a sharp singleton outranks a popular gripe, so the
  count never becomes the priority ranking.

When the dashboard's [[issues-view]] New form chooses `local`, it writes to this same store through the
programmatic write surface above — a thin caller, never a second local store. Other choices belong to the
unified [[issues]] port and the forge driver.
