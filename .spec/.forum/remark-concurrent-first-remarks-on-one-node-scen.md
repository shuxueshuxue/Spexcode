---
concern: remark: concurrent first-remarks on one (node,scenario) mint duplicate scenario threads (non-atomic dedup)
by: b234e3fc-c280-464d-9bb6-96db6e703ce8
status: open
nodes: remark-substrate
created: 2026-07-03T18:07:11.357Z
---

Adversarial audit of M1 remark-substrate (main 9dd0dc9). Refutes R4 ("track lives ONCE per (node,scenario)").

**What.** `resolveRemarkHost` (spec-cli/src/proposals.ts) reuses a scenario's single thread by `loadProposals().find(t => t.concern === evalConcernKey(node,scenario))`, then calls `forumPost()` to create it if absent. The find/create is NOT atomic: the find runs OUTSIDE `withForumLock`, only forumPost's write is locked, and `uniqueId()` dedups the FILENAME, not the concern. So two concurrent first-remarks on the same never-remarked (node,scenario) can both read "not found" and both create — yielding `eval-<n>-<s>.md` and `eval-<n>-<s>-2.md`: two threads for one key.

**Repro (real CLI, sandbox):** fire 30 concurrent `spex remark racenode --scenario <fresh> --body …`. Round 1 produced **2 distinct forum files carrying the identical `concern: eval: racenode · <s>`** — one with 29 remarks, one (`-2`) with a single orphaned remark. (Low-N bursts serialize on process-startup skew and hide it, but it IS reachable — reproduced at N=30.) Note: the single-process *server* path is protected by Node run-to-completion (the synchronous `propose` write finishes before the first `await`), so this is a CLI / multi-process race specifically.

**Invariant tension.** R4: "a scenario's remark track lives ONCE in trunk, keyed by (node,scenario), overlaid read-time." Spec body: "it never mints a second scenario store." The orphaned `-2` thread is invisible to the (node,scenario) key — `find` returns the first-created thread — so that remark's teeth (T1) never fire: a silent loss-signal blind spot, exactly what remarks exist to prevent. Note SpexCode actively encourages parallel workers, so two agents remarking the same fresh scenario concurrently is a normal dogfood situation, not exotic.

**Recommend.** Move the find-or-create INSIDE `withForumLock` (dedup by concern atomically), or make scenario-thread resolution dedup by concern at read time (and/or key `uniqueId` on concern for `eval:` threads). A downstream (node,scenario)→thread reader should also fold duplicate-concern threads rather than silently pick the first.

Severity: medium. Found by adversarial audit; [[remark-substrate]].
