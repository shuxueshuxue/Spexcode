---
title: commit-context
status: active
desc: Say a commit's spec context to its author once, from the final candidate index, and derive its Spec trailer from governors and re-versioned nodes.
code:
  - spec-cli/src/commit-context.ts
related:
  - spec-cli/templates/hooks/prepare-commit-msg
  - spec-cli/src/cli.ts
  - spec-cli/src/commit-context.test.ts
  - packages/spec-core/src/git.ts#gitTry
  - packages/spec-core/src/specs.ts#parseFrontmatter
  - packages/spec-core/src/specs.ts#mintIds
  - packages/spec-core/src/anchors.ts
---
# commit-context

At the moment an author commits, show which intent the change bears on. This is advisory context at
creation, not another lint pass. `related:` supplies reading context; only `code:` supplies governors.

`spex internal commit-context <message-file>` runs from the existing `prepare-commit-msg` hook, after
the index is final and while the message is writable. It prints one block to stderr, including with
`git commit -m`. Each changed path outside `.spec/` has one row:

```text
<path>  governed by [[node]], [[node]]  · touches [[node]]#symbol  · context: [[a]], [[b]] (+N)
<path>  (unclaimed — coverage)
re-versions [[x]], [[y]]
governed code changed, spec untouched: [[x]] — still true?
derived trailer → Spec: a, b
```

Empty clauses and summary lines are omitted. A path with related referrers but no governor says
`(no governor)` and still shows context. Referrers are distinct, sorted by id, capped at two plus a
remaining count. There is no relevance guess: the optional token-overlap heuristic adds noise without
changing the authoring question. Governors use the shared exact-path, directory-prefix and glob matcher.
`touches` intersects this commit's zero-context hunks with anchored units from both relations, using
spec-core's extractor registry and selector resolution on candidate content. Deletions within a surviving
unit use the candidate-side deletion position; a deleted unit has no candidate range and makes no touch
claim. Unavailable or failed extraction is stated on that path, without losing its governor or trailer.

Changed candidate `spec.md` files re-version their nodes. The question names governors of changed code
whose own `spec.md` is absent from the diff. The derived `Spec:` value is the sorted distinct union of
those governors and re-versioned nodes, never related referrers or anchor-only contextual hits. An
existing `Spec:` line is preserved verbatim, and the derivation line is omitted when it is preserved.
Otherwise a nonempty derived value joins the existing trailer paragraph via `git interpret-trailers`;
the message is newline-terminated first. [[identity-injection]] independently owns `Session:` stamping.

`MERGE_HEAD` means no context block and no derived Spec trailer: a combined change is not one author's
work. An amend compares the candidate index to HEAD, showing only newly staged changes; an inherited
Spec trailer is preserved just like a handwritten one. A message-only amend or tree-unchanged stamp,
including `spex spec ack` with unrelated dirty staging, produces no block or derived Spec trailer.

All module Git calls use [[git-exec]]'s helpers. Repository discovery strips hook Git environment as usual;
index reads explicitly pass the hook's `GIT_INDEX_FILE` through `gitTry`'s existing `indexFile` option. This
includes Git's temporary index for `--only`, pathspec and `-a` commits, never a substituted real index.
`write-tree` snapshots that index; declarations and anchor source are read from that immutable tree,
so unstaged files cannot supply context for absent bytes. There is no history walk or persistent cache.
Use the existing frontmatter parser and canonical id mint on batched tree blobs: `loadSpecs` derives
history and drift (measured 1.69 s for 375 nodes), while its filesystem-only lite view does not expose
candidate relations. The budget is at most 200 ms incremental work over the same launcher's nearly empty
`internal trunk` invocation; process and launcher startup are the baseline, not graph work. Interleaved
fresh-process measurements on this repository's anchored proof candidate give a 208 ms baseline and
197 ms median paired increment (individual increments 164–229 ms under shared host load). The full
context invocation's median is 398 ms. Graph reading accounts for 95 ms, diff/index work 34 ms, and
anchor extraction plus row construction 51 ms; trailer writing takes another 5 ms. These measurements
are evidence for the budget, never text in the commit block. The path scales with candidate declarations
and changed anchored source, not the repository's commit history.

No hook is added. Dogfood installs the canonical template with `npm run hooks`; adopters receive it through
`spex materialize` (also during `spex init`). The template resolves the committing checkout's CLI first,
then a project-local install, PATH, and the shared checkout launcher. An unavailable CLI, unknown verb,
or any failing invocation is silently skipped and never blocks the commit. The hook prints captured
stderr only after a successful invocation, keeping an older sibling checkout quiet while shared hooks
are ahead of its CLI. Identity stamping works even without that CLI.
