---
concern: drift signal is a linear git-log-position approximation, not git ancestry — silently under-reports (worst on adoption); lint.ts comment falsely claims rev-list rigor
by: 4b64d4ad-7844-4e32-a308-b4d33b25ccb8
status: landed
nodes: drift-by-ancestry
created: 2026-07-04T03:20:10.889Z
---

**What was compromised.** The shipped drift signal (`spex lint` drift rule + board freshness) computes "N commits ahead of spec" from a **one-dimensional position in `git log HEAD`**, not from true git ancestry. In `spec-cli/src/git.ts` `buildDriftIndex` builds `pos = Map<hash, i++>` by walking a flat `git log --name-only HEAD`, and `driftFor` decides drift purely by comparing those integer positions (`p < sp`). `git log HEAD` is ordered reverse-chronologically by commit date, so drift is a **timestamp-order guess**, exactly the approximation the `drift-by-ancestry` (pending) node documents: it "silently under-reports whenever the timeline isn't chronological … the failure lands hardest on adoption, where a whole spec tree is back-extracted onto an existing history and the under-report is near-total. The board goes green while the truth is not green."

**Where recorded.**
- Code: `spec-cli/src/git.ts` `buildDriftIndex`/`driftFor` (the `pos` map + position compares).
- **A comment that actively masks the gap:** `spec-cli/src/lint.ts:183-185` claims drift is *"Rigorous by git ancestry — loadSpecs computes driftFiles via `git rev-list <spec's last version>..HEAD -- <file>` … so each warning is 'N commit(s) ahead', not a timestamp guess."* This is false: there is no `rev-list A..HEAD` per file; it is the `pos` linear-position guess it explicitly denies being. The comment pre-empts the exact criticism while being the thing criticized.
- Intent on record: `.spec/…/source-of-truth/drift-by-ancestry/spec.md` (status: pending).

**Which invariant it defers/violates.** `[[spec-node-states]]` promises drift "measured by git ancestry"; `[[source-of-truth]]`/"git is the database" wants the loss signal true. This blinds the drift/loss signal against a stated invariant — a green board over real drift.

**Blast radius.** Every drift warning, the board's per-node drift count, and (transitively) `deriveStatus`. Under-reports on any non-linear history: merges, cherry-picks, back-dated commits, and especially **adoption/back-extraction** (near-total under-report) — the exact onboarding path the project wants to make trustworthy for open-source.

**Disposal.** Schedule — build the pending `drift-by-ancestry` DAG-reachability algorithm (the node IS the scheduled fix). **Immediately** correct the `lint.ts:183-185` comment so the code stops claiming ancestry rigor it does not have.

---

Fixed in node/drift-ancestry-1c62 (commit 9ed4268). The position compare is REPLACED, not paralleled: `buildDriftIndex`'s one cached walk now carries `%P` parent edges, and `driftFor`/`changedSince`/`scenarioMoved` answer "newer than the spec/reading" by in-memory DAG reachability (`ancestorsOf`, memoized bitsets — the equivalent of `rev-list version..HEAD -- file`; the `pos` map is gone). The ack floor is ancestry too: a `Spec-OK` quiets exactly the commits reachable from it. The lying lint.ts comment now states the real mechanism, and spec-lint's drift bullet drops its timing language (2f4df07). Off-history shas keep ONE conservative rule (orphan and reachable-but-unmerged alike: 0 drift measured from them, stale readings stamped with them) — the finer distinction is noted as deferred in the drift-by-ancestry body. A/B on yatsu scenario `branchy-drift-counted`: A/fail — a back-dated merged side-branch change yields 0 lint warnings while `rev-list V..HEAD` proves 1 commit of drift; B/pass — the same fixture warns "1 commit(s) ahead". Re-baseline on this repo surfaced 2 previously hidden drift rows (spec-cli/src/index.ts 7→8 ahead of spec-cli; init.ts newly 1 ahead of spex-init).
