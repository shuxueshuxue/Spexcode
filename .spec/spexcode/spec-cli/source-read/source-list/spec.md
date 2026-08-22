---
title: source-list
status: active
hue: 195
desc: One governed directory, listed over HTTP through the SAME predicate that decides what /api/source may open — so nothing is offered that cannot be read.
code:
  - spec-cli/src/source-list.ts
related:
  - spec-cli/src/source-list.test.ts
  - spec-cli/src/source-read.ts
  - spec-cli/src/source-files.ts
  - spec-cli/src/index.ts
---
# source-list

[[source-read]] opens a file the caller can already name. This names what is there to open. Together they
are the whole governed-source surface, and the split is the obvious one: a reader who has to know a path
before they can see a file cannot browse a project, and browsing ordinary code is the plainest thing an
editor does.

`GET /api/files?dir=<repo-relative>` returns `{dir, entries, truncated}`, where an entry is
`{name, path, kind}` and `kind` is `dir` or `file`. **One level per request.** The client expands a level at
a time, which is what makes the cost of opening the tree proportional to what the reader actually looks at
rather than to how large the repository is.

## one gate, not a second definition

**A file appears here exactly when `isSourceFile` would let `/api/source` open it** — the same predicate,
compiled from the same `spexcode.json` policy, that [[spec-lint]]'s coverage walk uses. This is the same
invariant [[source-read]] states, and it matters more on the listing side than on the read side: a row the
reader clicks and gets a 404 from is worse than a row that was never drawn. Two predicates that agree today
are two predicates free to disagree tomorrow, which is precisely how a panel ends up advertising something
the product refuses to show.

The visible consequence is worth saying out loud rather than discovering: a `.css` beside a governed `.tsx`
does not appear when the project's `sourceExtensions` do not admit it, and neither does a test file. That is
not the listing being incomplete — it is the listing being honest about a policy the project chose. The
repair is to widen the policy, in one place, where widening it also widens what lint governs.

## what a directory is

`isSourceFile` has no opinion about directories — it `lstat`s and demands a regular text file — so
directory admission is this node's own small rule, and it is stated rather than derived:

- **A directory is browsable when it lies inside a governed root, or CONTAINS one.** The second half is what
  makes `governedRoots: ['spec-cli/src']` reachable at all: every ancestor on the way down is outside every
  root while being the only path to one. `.` as a root means the whole project, so everything is inside.
- **`dir` empty lists the governed roots themselves**, so the tree has a top without the client having to
  read the project config. It asks the same question at every level, including the first.
- **`.git`, `node_modules` and dot-directories are never offered.** This is listing hygiene, deliberately
  NAMED and not dressed up as a gate: with no include globs configured `isSourceFile` would happily admit a
  dependency's shipped `.js`, so nothing derives this. A file inside one of them stays readable by direct
  address if the policy admits it; it simply is not somewhere the product invites you to browse.
- **Directories lead, then files, each alphabetical.** Decided here rather than in the client, so two
  clients cannot sort one listing two ways.

## refusals and bounds

Refusals mirror [[source-read]]'s, because they are the same surface: an absolute path or a `..` that
escapes the worktree is **400**, and a directory outside every governed root — or one that cannot be read at
all — is **404**. Both are loud; a refusal never degrades into an empty listing, because an empty listing is
a claim about the project and a refusal is a claim about the request. Containment is checked by RESOLVING
and comparing rather than by pattern-matching the string, so a `..` that normalises back inside is fine and
one that leaves is caught. An error names what the caller asked about and never where the checkout lives —
Node puts the absolute host path into its exception messages, and these strings are API responses.

Bounded like [[node-attachments]]'s walk and for its reason: a directory that has accumulated ten thousand
generated files should degrade into a long list rather than a wedged read. The cap is on ENTRIES, and there
is deliberately no depth cap — the walk is one level, so a depth bound would guard a recursion that does not
exist. Unlike that walk, a clipped listing says so: `truncated` is on the response, because a client that
cannot tell "this is everything" from "this is the first 500" will quietly show the reader a lie.

A vanishing entry mid-listing is skipped rather than thrown out of the endpoint; the route is a thin caller
with no cache, reading the worktree at request time.
