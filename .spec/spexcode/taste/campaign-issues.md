# SpexCode De-Drift Campaign — Issue Sweep (fan-out finder, fresh-context)

> Read-only sweep of the codebase + spec tree against the 20 tastes (§1) and the 10 KEEP/DROP gates
> (§2) in `campaign-framework.md`. Seed issues I1–I10 are **NOT** re-reported here — and note that the
> two known codex bugs (**I1** `head -1` multi-file truncation, **I2** `hp_field` `[^"]*` truncation)
> are **already FIXED on this head**: `hp_field` (harness.sh:16–54) now does a proper JSON-string
> escape-decode and the apply_patch path (harness.sh:149) emits ALL `*** … File:` markers with no
> `head -1`. The framework §3 describes the pre-fix state; those two are residue, not open.
>
> Each finding: ID · file:line · taste broken · 1-line description · KEEP/DROP (criterion) · fix sketch.
> Sorted KEEP-first, highest value first. Verified live where the claim was load-bearing (grep'd caller
> counts, sourced the shell, read the CSS var palette). Several plausible-looking smells were checked
> and **dropped as non-issues** — listed at the bottom so the next finder doesn't re-chase them.

---

## KEEP (fix now, autonomously)

### N1 · `hp_ask_note` truncates at the first quote AND `head -1` — the SAME bug class §3 fixed in `hp_field`, left unfixed here
- **File:** `spec-cli/hooks/harness.sh:97-100`
- **Taste:** T16 (fail-loud / no silent truncation), T3 (conformance IS the contract), T17 (one mechanism)
- **Desc:** `hp_ask_note` parses the ask payload's `"question"` field with `grep -o '"question"…"[^"]*"' | head -1` — the exact `[^"]*` truncation the framework flagged for `hp_field` (I2) and the exact `head -1` first-only flaw it flagged for the path parser (I1), but in this helper neither was fixed. A question containing an escaped `\"` (common) is silently cut short; the board note is wrong, never loud. This IS a live path: `mark-active.sh` (`.config/core/mark-active`) and `idle.sh` call `hp_is_ask` + `hp_ask_note` on every ask.
- **Verdict:** **KEEP.** C1 (correctness toward the advertised capture, no new behavior), C2 (cite T16/T3 — the correct end-state is unambiguous: capture the whole JSON-string value, exactly as `hp_field` already does), C3 (one helper, one file), C4 (parser round-trip proves it), C5 (no new noun — *collapse onto the existing `hp_field`*: `hp_ask_note() { hp_field "$1" question; }`, which is the T17 two-for-one — one decoder serves both fields).

### N2 · `ownsWorktrees` is a decorative interface member — 0 callers
- **File:** `spec-cli/src/harness.ts:30` (decl), `:253`/`:271` (the two values)
- **Taste:** T1 (honest boundaries, not decorative), T11 (smallest impl)
- **Desc:** `readonly ownsWorktrees: boolean` is declared on the `Harness` interface and set true/false per adapter, but **read nowhere** — `rg ownsWorktrees` hits only the three definition lines. Deleting it changes nothing observable. A type-checking abstraction that lies it's load-bearing (the textbook T1 smell; its sibling `ownsRendezvous` IS used at sessions.ts:79, so this is a clean isolated dead member).
- **Verdict:** **KEEP.** C1 (removes a primitive — member count down), C2 (T1 is exactly "an interface method every backend stubs that no test would catch if deleted"), C3 (one decl + two literals, `git revert`-clean), C4 (the diff is the observable proof — interface shrinks), C5 (pure removal, no new name). Fix: delete the three lines.

### N3 · `App.jsx:174` hardcodes `#268bd2` and `#ded7bf` — literal twins of `--blue` / `--line`
- **File:** `spec-dashboard/src/App.jsx:174`
- **Taste:** T19 (one design language — reuse the palette, don't duplicate it)
- **Desc:** The spec-tree edge stroke is `stroke: hot ? '#268bd2' : '#ded7bf'` — both are **exact** literals of CSS vars defined in styles.css (`--blue: #268bd2` line 11, `--line: #ded7bf` line 7). The palette is forked: a future re-theme of `--blue` silently skips these edges. (React Flow's inline `style` can't take `var()` directly, so the fix is a JS constant sourced once.)
- **Verdict:** **KEEP.** C1 (collapses two literals onto the single palette source — behavior identical), C2 (T19 "one symbol/color vocabulary" — the right end-state is determined: use the existing var values, no new color), C4 (rendered surface, screenshot-equal before/after), C5 (no new var — reuse `--blue`/`--line` via a small JS const or `getComputedStyle`). *Mild caveat:* the JS-binding shape is a hair of judgment (C8), but the **values** are already named, so it stays KEEP.

### N4 · `harness-report.html` — a generated machine-render committed at the worktree root
- **File:** `/harness-report.html` (29 KB, root)
- **Taste:** T14 (the project folder holds only human-readable prose/config), T8 (non-polluting)
- **Desc:** A 29 KB self-contained HTML review report (inline `<style>`, `lang="zh"`, a rendered audit) sits in the repo **root**. It is a generated artifact — a render, not prose a human edits in-tree. T14: hashes/locks/manifests/machine-only renders belong in the global store or git-ignore, not `.spec/` or the worktree root.
- **Verdict:** **KEEP** (conditional on it being machine-curated — it is: a styled HTML render, not a maintained doc). C1/C4 (cleaner tree, observable: `git ls-files` root shrinks), C3 (one file, `git rm`-clean + revert-clean), C5 (removal). Fix: `git rm` it (move to global store) or add to `.gitignore`. *If a human curates it as a deliverable, downgrade to DROP — but its form says generated.*

### N5 · `HARNESS-REFACTOR-REPORT.md` — a self-labeled "WORKING DOC" scratch report at root
- **File:** `/HARNESS-REFACTOR-REPORT.md:3` ("Status: WORKING DOC … Branch `node/Codex-93fd`")
- **Taste:** T14 (project folder = durable human prose), T8
- **Desc:** A 27 KB in-flight working doc tied to one branch sits at the repo root. It explicitly self-labels transient ("rewritten in place", "becomes the final report"). Branch-scoped scratch is exactly what T14 says dies with the work, not what stays in-tree.
- **Verdict:** **KEEP.** C1/C4 (tree cleanliness, observable), C3 (one file), C5 (removal). Fix: remove from the tree (it's a session artifact for this branch, not a durable spec/doc). *Borderline only if the maintainer wants it promoted to `docs/` as the final report — but as a tracked root "WORKING DOC" it's pollution.*

### N6 · `firecoder-scout.md` — a one-off recon report at root
- **File:** `/firecoder-scout.md` (16 KB, root)
- **Taste:** T14, T8
- **Desc:** A reconnaissance report ("reconnaissance only … No implementation") about an external project, parked in the repo root. A scouting note, not durable spec/config — same root-pollution class as N4/N5.
- **Verdict:** **KEEP.** C1/C4/C3/C5 same as N5. Fix: move to `docs/` if it's worth keeping, else `git rm`. (Lower value than N4/N5 since it's smaller and harmless, but it's the same mechanical T14 removal.)

### N7 · `gateway.ts:29` silently swallows a MALFORMED `spexcode.json`
- **File:** `spec-cli/src/gateway.ts:29`
- **Taste:** T16 (fail loud; separate missing-vs-malformed)
- **Desc:** `try { fileCfg = JSON.parse(readFileSync('spexcode.json'))?.serve?.public ?? {} } catch { /* no/!json config */ }` collapses two failure layers into one silent default: a **missing** file (legitimate — no config) and a **malformed** file (a real, fixable error) both fall through to `{}`. Every neighboring branch in this function is meticulously loud (lines 37/42/48/50 all `console.error` + repair path) — this one swallow is the outlier. A user with a typo'd `spexcode.json` silently gets default public-mode behavior.
- **Verdict:** **KEEP.** C1 (behavior-equivalent for the missing case, adds the loud branch only for the real-error case — no new primitive, just split the catch on `existsSync`), C2 (T16 is verbatim "separate config failures into layers… never hide behind a quiet default"; the function's own style sets the determined end-state), C4 (observable: a bad config now warns), C5 (no new noun — reuse the `existsSync` already imported, and the `console.error` pattern already used 4× in this file). *Slightly higher judgment than N1–N2 (what exactly to print), but the file's own idiom fixes that.*

---

## DROP (defer / needs a human / not actually a smell)

### N8 · `hp_field`/`hp_ask_note` divergence is itself a two-for-one signal — but the merge is N1
- Folded into N1 (the fix collapses `hp_ask_note` onto `hp_field`). Not a separate issue.

### N9 · `.config` has 11 children, `spec-cli` 10, `spexcode`/`sessions`/`source-of-truth` ≥8 — breadth lint warnings
- **File:** lint output (`spex lint` breadth rule)
- **Taste:** T10 (intermediate grouping over a flat pile)
- **Desc:** Five nodes trip the `maxChildren=8` breadth warning. The lint message itself hedges ("a flat list of genuine peers is sometimes right").
- **Verdict:** **DROP.** C8 (which children to group under which new parent is a taste/naming call only a human makes — the `/regroup` plugin exists precisely because this needs judgment), C6 (regrouping reparents the tree = a structural decision). Not autonomous.

### N10 · 17 `altitude` warnings (bodies read low-altitude / over budget)
- **File:** lint output (harness-adapter 100 lines, session-console 101, state 94, graph 81, …)
- **Taste:** T13 (spec at the right altitude)
- **Desc:** Many spec bodies exceed the line/char/density budget — they read as mechanics, not contract.
- **Verdict:** **DROP.** C8 (rewriting a spec body to a higher altitude is authorship — the "right" prose is a judgment, not a determined end-state), C1-fail (it's net authoring effort, not a removal/unification). A real campaign target but a *human-prose* one, not a mechanical de-drift.

### N11 · `selfSummary.test.ts` is ungoverned (no spec `code:` references it)
- **File:** `spec-cli/src/selfSummary.test.ts` (lint `coverage` warning)
- **Taste:** T13 (every code file maps to a node)
- **Desc:** Lint flags this test file as governed by no spec node.
- **Verdict:** **DROP.** Adding it to a node's `code:` is a small call, but *which* node owns a test (the tested feature's node? a test node?) is a structural decision (C8), and it widens a node's `code:` frontmatter (borderline C6). Other tests (`selectors.test.ts`, `agent-reply-channel.test.ts`) ARE governed, so the right home exists — but picking it is a human's. Low value, defer.

### N12 · `drift` warnings: ~15 files 1–5 commits ahead of their spec
- **File:** lint output (sessions.ts +4, styles.css +5, App.jsx/data.js +3, keymap.js +3, …)
- **Taste:** T13 (drift is the smoke detector)
- **Desc:** The standard drift ledger after the refactor. Each needs the diagnose-then-ack-or-rewrite ritual.
- **Verdict:** **DROP** (as a *bulk* item). C2-fail per-file without reading each delta: ack-vs-rewrite-vs-fix-code is the exact judgment the drift guidance says "never patch, never blind-ack." C9 (each needs its own live diff read). Individual drifts may become KEEP after a per-node diagnosis, but the bundle is not autonomous.

### N13 · Codex thread-id capture "deferred; the MVP leaves liveness + launch + delivery working without it"
- **File:** `.spec/spexcode/spec-cli/sessions/harness-adapter/spec.md` (and harness.ts:77-80 `resumeArg` returns `''` → relaunch FRESH)
- **Taste:** T9/T13 (honest deferral)
- **Desc:** Codex `resumeArg` returns empty (relaunch fresh, not resume) until the real thread id is captured. The spec documents this as a known MVP gap.
- **Verdict:** **DROP.** C7/C6 (capturing the thread id and wiring real resume is *new behavior/feature work*, not de-drift). It's an honestly-declared limitation (framework I11/I9 pattern), not stale drift. Park.

### N14 · forge issue-events deferral in `yatsu-eval-tab` ("LOCAL readings only for now")
- **File:** `.spec/spexcode/spec-yatsu/yatsu-eval-tab/spec.md:21`; `.spec/spexcode/spec-forge/dashboard-issues/spec.md:59`
- **Taste:** T13
- **Desc:** Two specs describe a forge live-push / issue-events source as a later layer; current MVP is local readings.
- **Verdict:** **DROP.** C7 (the deferred work is a real feature, not closed-but-unrecorded drift). Honestly-declared not-yet-done; not a de-drift target (framework I9: a note describing real undone work is DROP). Park.

### N15 · `App.jsx:392` + `SessionGraph.jsx:362` both hardcode `#cdc6ad` for the dots Background, no var
- **File:** `spec-dashboard/src/App.jsx:392`, `spec-dashboard/src/SessionGraph.jsx:362`
- **Taste:** T19, T12 (one helper for two sites)
- **Desc:** Both graph backgrounds set `<Background color="#cdc6ad">` — a literal duplicated across two files that is NOT in the palette (closest is `--line` #ded7bf, but not equal). Unlike N3 there's no existing var to collapse onto.
- **Verdict:** **DROP** (borderline). Unifying the two sites is real (T12), but doing it *right* means either (a) adding a NEW palette var (C6 — widens the `.config`/CSS surface) or (b) choosing whether to snap it to `--line` (a color **change** = C8 judgment + C7 visible-behavior change). Either branch needs a human pick. Note it; don't auto-fix. (N3 stays KEEP precisely because its values already have names.)

### N16 · `docs/sdd-tuxedo-pooh.png` — a 156 KB binary image in-tree
- **File:** `/docs/sdd-tuxedo-pooh.png`
- **Taste:** T14 (human-readable things)
- **Desc:** A 156 KB PNG tracked under `docs/`. T14 says the project folder holds prose/config; a binary blob is neither.
- **Verdict:** **DROP.** C8 — an image *can* be a legitimate human-facing doc asset (a diagram), and whether this one is durable documentation vs. scratch is a judgment the maintainer makes. Unlike N4/N5 (self-evidently generated/working scratch at root), a `docs/`-placed image is plausibly intentional. Flag, don't remove.

---

## Non-issues checked and rejected (so the next finder skips them)

- **harness branching outside the adapter (T2):** swept the whole tree — **clean.** All `if (codex|claude)` lives in `harness.ts`, `harness.sh`, and the `dispatch.sh` detector. Product code resolves an adapter (`harnessById`) and iterates `HARNESSES`. No T2 violation.
- **`💬` at SessionGraph.jsx:219 (an early agent's claim):** FALSE — the actual glyph is `⇄` (monochrome geometric arrow = the design language). No emoji there.
- **`SPEXCODE_SKIP_LINT` "documented but never read" (an early agent's claim):** FALSE — it IS read, in `spec-cli/templates/hooks/pre-commit:25`. The `cli.ts:161` message correctly points at the git-hook bypass. No issue.
- **index.ts WS catches (`/* viewer gone */`, `/* ignore */` resize):** NOT T16 — a disconnected viewer and a malformed control frame on a network surface are *expected*, correctly-bounded best-effort, not swallowed failures.
- **sessions.ts / pty-bridge "transient hiccup" catches:** these are tick-retried best-effort with stated reasons + a next-tick recovery — the bounded "break-then-recover" pattern, not silent dead-path masking. Left as-is (would need per-catch judgment to promote any to a finding; none stood out as a *masked dead path*).
- **`commsLog()` / `rvEnv(harness=HARNESS)` default / `toSession(activity=null)` default (single-caller wrappers, unused defaults):** thin, harmless, negligible — not worth an autonomous churn-commit (C4-fail: no observable surface difference).
- **No orphaned/non-existent `code:` pointers:** all 104 specs' `code:` paths exist on disk; no stale pointer drift.

---

## Tally

**7 KEEP / 9 DROP** (plus 7 rejected non-issues).

### Top KEEP by value
1. **N1** — `hp_ask_note` truncation (live hook path, T16/T3, collapses onto `hp_field` = two-for-one).
2. **N2** — delete decorative `ownsWorktrees` interface member (T1, clean removal).
3. **N7** — `gateway.ts:29` split the silent malformed-config swallow (T16, fits the file's own loud idiom).
4. **N3** — `App.jsx:174` reuse `--blue`/`--line` instead of literal hex twins (T19).
5. **N4** — `git rm` the generated `harness-report.html` from root (T14).
6. **N5** — remove the branch-scoped `HARNESS-REFACTOR-REPORT.md` "WORKING DOC" from root (T14).
7. **N6** — relocate/remove the one-off `firecoder-scout.md` from root (T14).

> Honest note: the highest-leverage real bugs in §3 (I1/I2) are already fixed on this head — the live
> de-drift surface here is thinner than the seed list implied. N1 is the one remaining bug of that exact
> class; N2 and the three root-pollution removals (N4–N6) are the cleanest mechanical KEEPs.
