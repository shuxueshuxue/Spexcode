# SpexCode De-Drift Campaign — Simplifications Sweep (fresh-context, behavior-equivalent only)

> Read-only hunt for **behavior-EQUIVALENT but simpler/more-unified** changes in the just-landed
> harness-agnostic refactor (`harness.ts` / `harness.sh` / `dispatch.sh` / `sessions.ts` / `layout.ts` /
> `materialize.ts` / `slash-commands.ts`). Scored against the 20 tastes + 10 KEEP/DROP gates in
> `campaign-framework.md`. Seed issues I1–I12 and the prior sweep's N1–N16 are **NOT** re-reported.
>
> **Headline verdict: the new code is already clean — 1 real KEEP only.** The richest seam I was pointed
> at (the harness adapter + its shell mirror) is genuinely well-factored: one adapter table, one
> dispatcher, no product-code harness branches, no decorative interface members surviving on this head
> (N2 `ownsWorktrees` and N1 `hp_ask_note` are ALREADY fixed here). The two-for-one collapses the
> framework hoped for were mostly already done by the refactor itself. What remains is one verbatim
> shell⇄TS duplication (S1) and a handful of micro-smells that are honestly DROP (churn, no observable
> surface, or a judgment call). I went looking hard for if/else ladders that wanted a table, over-general
> single-callers, and recomputation — and the code had largely beaten me to each.
>
> Each finding: ID · file:line · taste · CURRENT shape · PROPOSED shape · why behavior-equivalent · KEEP/DROP.

---

## KEEP (fix now, autonomously)

### S1 · The config content-hash command is duplicated VERBATIM across the shell⇄TS mirror
- **File:** `spec-cli/hooks/dispatch.sh:36` (`cfghash()`) ↔ `spec-cli/src/materialize.ts:28-35` (`contentHash()`)
- **Taste:** T17 (one mechanism, not two mirrored copies), T13 (the mirror is exactly where drift hides), T16 (a silent divergence is a silent failure)
- **CURRENT:** the **same** `find .spec/*/.config .spec/*/config \( -name '*.md' -o -name '*.sh' \) -type f -print0 2>/dev/null | sort -z | xargs -0 cat 2>/dev/null | sha256sum | cut -d' ' -f1` string is written out **twice** — once as the shell gate `cfghash` in dispatch.sh, once embedded as a `bash -c` string literal in materialize.ts. Both carry a comment that the other "MUST match" it.
- **PROPOSED:** define it ONCE as a function in the existing shell mirror `harness.sh` (e.g. `hp_config_hash`, which already lives at the seam dispatch.sh sources for `hp_runtime_dir`), then: dispatch.sh calls `hp_config_hash` (it already `. "$SPEXCODE_HARNESS_LIB"`); materialize.ts's `execFileSync('bash', ['-c', ...])` becomes `'. "$LIB"; hp_config_hash'` (it already resolves the package's `hooks/` dir for `DISPATCH`, so the lib path is in hand). One definition, two call sites.
- **Why behavior-equivalent:** the hash is computed by the *same find|sort|cat|sha256sum* pipeline either way — byte-identical output. The two callers' jobs (gate compares; materialize stamps) are unchanged; only the *source* of the one string collapses from two copies to one.
- **Verdict:** **KEEP.** C1 (removes a duplicated mechanism — one definition replaces two), C2 (cite **T17**/**T13**: the seam's own comments declare they MUST stay identical — the determined end-state is a single source of truth, exactly like `hp_session_id`/`encodeProject` are already shared across the boundary), C3 (touches `harness.sh` + the two callers, `git revert`-clean, bounded), C4 (observable via a round-trip: the gate's hash and materialize's stamped hash provably equal because they run the same code — and a mutation test on the find expr now can't desync them), C5 (no new noun — it's the `hp_*` shell-helper convention already in `harness.sh`; the TS side reuses the lib path it already computes). *This is the one genuine shell⇄TS mirror-drift collapse in the refactor; every other cross-boundary fact (session-id resolution, project encoding, runtime dir) is ALREADY shared, this one was missed.*
  - *Mild caveat (keeps it KEEP, not DROP):* materialize.ts must locate `harness.sh`. It already derives `PKG` and `DISPATCH = join(PKG,'hooks','dispatch.sh')`, so `join(PKG,'hooks','harness.sh')` is one line — no path-resolution complexity added. If the maintainer prefers the find-expr live in materialize.ts and dispatch.sh source IT, that's a defensible flip (a hair of C8) — but the determined principle "one copy" holds either way; harness.sh is the natural home because it's already the sourced shell mirror.

---

## DROP (defer / judgment / not worth an autonomous churn-commit)

### S2 · `harnessById(x || defaultHarness.id)` repeated 5× — a thin would-be helper
- **File:** `spec-cli/src/sessions.ts:336, 745, 764, 936, 1376`
- **Taste:** T12 (one helper for five sites)
- **CURRENT:** five sites write `harnessById(<rec>.harness || defaultHarness.id)` with different record shapes (`rec.harness`, `s.harness`, `wt.rec.harness`, `readRecord(id)?.harness`).
- **PROPOSED:** a `harnessOf(h?: string) => harnessById(h || defaultHarness.id)` one-liner.
- **Verdict:** **DROP.** C4-fail — zero observable surface difference (it's an internal expression dedup), and the saving is 5 short lines → 5 short lines + 1 helper. The repeated bit is just `|| defaultHarness.id`, already maximally terse. This is the negligible-wrapper class the prior sweep explicitly declined (its "single-caller wrappers, unused defaults … not worth an autonomous churn-commit"). Trading one clear idiom for a named helper here is churn, not simplification.

### S3 · `harness = HARNESS` default param on `launch` / `launchScript` (vestigial — every caller passes it)
- **File:** `spec-cli/src/sessions.ts:621` (`launchScript`), `:629` (`launch`); same pattern as `rvEnv` `:73`
- **Taste:** T11 (no unused params), T9 (no speculative generality)
- **CURRENT:** all three take `harness: Harness = HARNESS`, but **every** live caller passes an explicit `h` (launch @767/@940 → `h`; launchScript @631 and rvEnv @626 pass the param through). The default is never exercised.
- **Verdict:** **DROP** (already-noted residue). The prior sweep already flagged the `rvEnv(harness=HARNESS)` unused default and DROP'd it as "thin, harmless, negligible — C4-fail: no observable surface difference." `launch`/`launchScript` extend the SAME unused-default; dropping the `= HARNESS` on all three is correct-but-invisible, so it stays the same DROP. (If a maintainer is touching this code for another reason, removing the three dead defaults is a free tidy — but not its own autonomous commit.)

### S4 · `harness || 'claude'` (string literal) at `fromRaw`:214 / `writeRecord`:236 vs `|| defaultHarness.id` elsewhere
- **File:** `spec-cli/src/sessions.ts:214, 236`
- **Taste:** would-be T2 (one harness-default source) — but see why it's correct
- **CURRENT:** two record-shaping sites hardcode the literal `'claude'`; five runtime sites use `defaultHarness.id`.
- **Verdict:** **DROP** (NOT a smell — correct as-is). These two are the **legacy-record migration default**: "a record written before the harness field existed was historically claude," per the 214 comment. That is a fact about *old data*, not the *launcher* default — so it must NOT follow `defaultHarness` if that ever flips to codex (an old un-set record is still a claude record). Collapsing it onto `defaultHarness.id` would silently mis-attribute legacy records (C7 — changes behavior). The literal is the right call; leave it.

### S5 · `claudeSlashCommands` dedupe/sort (`dedupeSort`) vs `codexSlashCommands` inline order-preserving dedupe
- **File:** `spec-cli/src/slash-commands.ts:146-153` vs `:236-241`
- **Taste:** would-be T12 (one dedupe for two builders)
- **CURRENT:** claude uses `dedupeSort` (rank-then-name sort); codex uses a bespoke inline dedupe that PRESERVES the built-in enum (presentation) order then appends alpha-sorted prompts.
- **Verdict:** **DROP** (NOT behavior-equivalent). The two orderings are *intentionally different* — claude sorts everything by rank+name; codex must keep its built-ins in codex's own enum order (documented at :235). Unifying them would change the codex menu's observable order (C7). The divergence is a real product difference, not duplication. Correct as-is.

### S6 · `_hp_codex_cmd_path` mutation detection by `case` string-match on `> / >> / tee / sed -i / dd`
- **File:** `spec-cli/hooks/harness.sh:151`
- **Taste:** would-be T17 (a table over a case ladder)
- **CURRENT:** `case "$cmd" in *' >> '*|*' > '*|...) is_mutate=1 ;; esac`.
- **Verdict:** **DROP** (framework I12). The write-shape detection is acknowledged best-effort heuristic; the `case` glob-arms ARE the unified mechanism for a shell (there's no cheaper table for glob matching in pure bash). Tightening it is open-ended judgment (C8). No simplification available that isn't a behavior change.

---

## Non-smells checked and cleared (so the next finder skips them)

- **`harness.ts` adapter interface (T1/T3):** every member is read by product code — `events` (buildShim/writeCodexTrust), `ownsRendezvous` (rvEnv:79, liveness:260), `sessionEnvVar` (layout.envSessionId:127), `contractFiles`/`shimFile`/`shim`/`writeTrust` (materialize), `slashCommands` (the API), `liveness`/`deliver`/`resumeArg`/`launchCmd`/`sessionIdArg` (sessions). **No decorative member survives on this head** — `ownsWorktrees` (the prior sweep's N2) is already gone. The interface is honest.
- **`buildShim` / `writeCodexTrust` event loops:** both iterate the harness's own `events` array — the per-event command is generated by ONE `cmd(e)` closure shared between the shim and the trust hash (so they hash identically, as the comment requires). This is the *correct* two-for-one, already done; no further collapse.
- **`writeManagedBlock` comment-style param:** the `comment = ['<!-- ',' -->']` default with the `['# ','']` override (`.gitignore`) is exactly the ONE-primitive-serves-all-managed-files collapse the framework asks for (T17) — it's the *good* shape, used by 3 call sites (md contracts ×2, gitignore). Not over-general; genuinely multi-caller. Keep.
- **`materialize` HARNESSES loop:** renders every harness's artifacts in one pass with zero per-harness branch — adding a harness adds an adapter, not a branch. Textbook T2/T17. Clean.
- **`dispatch.sh` stale-shim fallback (`harness=claude; case $1 in claude|codex) …`):** not a dead branch — it's the deliberate back-compat for a shim still rendered as the old `dispatch.sh <Event>` shape (documented :20-21). Live-reachable on an un-re-materialized worktree; fail-soft by design, not vestigial.
- **`layout.ts` caches (`commonDirCache`, `deltaCache`):** real recomputation-avoidance with stated cost (~60 rev-parse forks / board build; 3 git diffs / worktree), correctly keyed and bounded (the closed-session eviction at :202). This is the *right* memo, not premature optimization. The fail-loud cache-bypass on an unreadable merge-base (:160) is correct T16. Keep.
- **`hp_field` (harness.sh:16-54):** the single awk JSON-string decoder now serves `hp_session_id`, `hp_tool`, `hp_ask_note`, `hp_code_path`, `hp_notification_type` — the I1/I2 truncation bugs are fixed AND `hp_ask_note` already collapsed onto it (the prior sweep's N1). One decoder, five callers. Already the two-for-one. Nothing left to collapse.

---

## Tally

**1 KEEP / 5 DROP** (plus 7 non-smells cleared).

The verdict is **"the new code is already clean — 1 small win only."** The harness refactor did the two-for-one
collapses itself (one `hp_field` decoder, one `cmd(e)` closure for shim+trust, one `writeManagedBlock` for every
managed file, one HARNESSES loop with zero product branches). The de-drift seam is genuinely thin here.

### Top KEEP by value-to-risk
1. **S1** — collapse the verbatim-duplicated config content-hash command into one `harness.sh` helper shared
   by dispatch.sh and materialize.ts (the one real shell⇄TS mirror-drift left; every other cross-boundary fact
   is already shared). Low risk: same pipeline, byte-identical output, bounded blast radius, `git revert`-clean.

> (S2–S6 are honest DROPs: S2/S3 are invisible micro-churn, S4/S5 are correct-as-is and would CHANGE behavior
> if "simplified," S6 has no cheaper unified shell form. Reported so the next finder doesn't re-chase them.)
