# SpexCode De-Drift Campaign — Framework

> Distilled from `.spec/spexcode/taste/spec.md` (the maintainer's raw 13) and
> `.spec/spexcode/taste/ten-challenges.html` (the adversarial synthesis), then sharpened by a
> fresh-context pass (the outsider-as-contraction-operator, per meta-insight D). This doc is the
> **framework phase** payload: the 20 tastes that judge a change, the 10 criteria that gate an issue,
> and a seed issue list with worked KEEP/DROP verdicts for the fan-out finders.
>
> Scope note: read-only analysis. The two known codex bugs and the emoji smells below were confirmed
> **live** (sourced `harness.sh`, ran the parsers) — see §3.

---

## §1 — THE 20 TASTES

Each taste is a **checkable** principle: a name, a 1–2 sentence statement, and (where it bites) the
concrete **smell** that violates it. They are sharper than the raw 13 — overlaps merged, conflations
split, and the debate-surfaced ones (honest-not-decorative, refusal-over-addition, present-not-alive,
own-the-earliest-moment, outsider-as-contraction) promoted to first class.

### A. Boundary & architecture honesty

**T1 · Honest boundaries, not decorative ones.**
A harness/platform boundary is load-bearing only if violating it **breaks something observable**. The
metric is behavioral-equivalence proven through the product surface, never `if(codex)` branch-count.
*Smell:* an interface method that every backend stubs / returns the same value / no test would catch if
deleted — uniformity reached by **erasure** (flattening a real difference) or by a type-checking lie.

**T2 · One adapter seam, zero product-code harness branches.**
All harness divergence lives behind the single `Harness` adapter (`harness.ts` / `harness.sh`); product
code (materialize, sessions, board, slash, dispatch) speaks one canonical vocabulary.
*Smell:* an `if (codex)` / `if (claude)` / payload-shape sniff anywhere outside the adapter or the
harness detector.

**T3 · Conformance suite IS the contract.**
A capability the runtime cannot honor on a harness is **removed from the interface, never stubbed**. The
adapter's contract is the set of YATU scenarios it reproduces identically on every harness.
*Smell:* a method advertised on the interface but inert on one harness (e.g. spec-of-file silently
no-op'ing on codex — exactly the multi-file bug class in §3).

**T4 · Platform differences live at the transport/adapter edge.**
Product semantics must not know whether the transport is a socket, send-keys, SSE, or SSH; liveness and
delivery are adapter methods (`ownsRendezvous`, `liveness`, `deliver`), not hard-wired sockets.
*Smell:* a rendezvous-socket path or tmux send-keys call reached directly from sessions/board code.

### B. Self-launch & delivery shape

**T5 · Self-launch is the main body; the dashboard is a strict reduction.**
A user on naive Claude/Codex with NO server gets the FULL system via `spex init` + materialize →
auto-discovery. The dashboard reduces to that path plus a **minimal, declared** governed delta.
*Smell:* any capability that only works when the backend is alive — a dashboard-only feature with no
file-only realization is a bug-in-waiting.

**T6 · Prefer *present* over *alive*; ship data into the harness's own loop.**
The design test for every capability: does it need to be **alive** (a running process at the instant of
need) or merely **present** (a file written before the need)? Default to present — config-as-data,
materialized hooks — and borrow the harness's always-running discovery loop instead of owning a process.
*Smell:* a bespoke daemon/coordinator doing work a materialized file + the harness's hook loop already do.

**T7 · Own the earliest durable moment; let inheritance carry it downhill.**
When you can't own a foreign id, key governance on what you control at t0 (the env-seeded
`SPEXCODE_SESSION_ID`) and demote any system-minted id to a recorded attribute. Carry the seed through
the **environment** (survives re-exec / self-launch), not arguments.
*Smell:* keying a record on a late-born foreign id, or a parallel id-namespace that can desync.

**T8 · Zero-friction, non-polluting adoption.**
`npm install spexcode` → `spex init` → user launches their own claude/codex, with NO global
claude/codex pollution and NO overwrite of the user's existing `CLAUDE.md` / `AGENTS.md` content.
*Smell:* init clobbering user content, writing to a global config without a declared/scoped reason, or
requiring a manual human step after init.

### C. The calculus of refusal

**T9 · Spend complexity only to buy it back.**
A need earns a code change ONLY if satisfying it is **complexity-negative or behavior-equivalent-but-
simpler**. This is a near-type-check, not a value-vs-cost weigh: does the change add a primitive or a
branch? If yes, reject regardless of value.
*Smell:* "just one more if-else" / a new flag / a new noun justified by user value alone.

**T10 · Collapse onto existing primitives; refusal is the core competence.**
Route every accepted need through a forced re-decomposition onto existing nouns (read 拧巴 as
"not-yet-decomposed"). The work of saying no well is the **re-derivation**, not the argument.
*Smell:* a new module/concept that, looked at twice, is two existing primitives wearing a trench coat.

**T11 · The smallest implementation that fully satisfies — no gold-plating, no half-done.**
Prefer the minimal code that meets the whole requirement. Defensive ceremony is only earned by real risk.
*Smell:* speculative config, unused params, abstraction layers with one caller, error handling for
conditions that cannot occur.

**T12 · Two-for-one is the signal of good form.**
A change is well-shaped when it also explains a neighboring scenario / closes a second gap for free
(hold the form, let function unfurl). One fix landing two needs = keep; one fix needing two mechanisms =
suspect.
*Smell:* a fix that solves its case but makes the adjacent case harder.

### D. The living spec↔code contract

**T13 · Alignment is the gap, measured as reconstruction loss.**
Alignment lives in neither spec nor code but the gap between them; the honest measure is whether a fresh
agent can **decode** the code from the spec (and vice-versa). Hash-drift is the cheap smoke-detector
proxy, not the thermometer.
*Smell:* treating a clean hash as proof of alignment, or a spec that is un-drifted but wrong.

**T14 · The project folder holds only human-readable things.**
Manifests, hashes, locks, runtime scratch hide in the global store (`~/.spexcode/projects/...`); what
stays in-tree is prose a human would accept. The worktree root stays clean; scratch dies with `.session/`.
*Smell:* a hash/lock/manifest or machine-only artifact committed into `.spec/` or the worktree root.

**T15 · Memory & identity hygiene — namespace the syntactic, norm the semantic.**
Never write session/role/identity markers ("I am the supervisor") to project-keyed shared memory.
Namespace what is decidable by code (the store key); leave content hygiene to the **instructed mind**,
because only a mind can judge the durable/transient meaning boundary.
*Smell:* a per-instance fact in shared memory; OR a hard write-filter trying to classify meaning a
mechanism can't decide (a fake re-implementation of the LLM — 画蛇添足).

### E. Determinism & failure

**T16 · Fail loud; no silent fallback.**
Surface errors and the repair entrypoint; never hide a failure behind a quiet default. Separate
auth/runtime/config failures into layers rather than one vague diagnosis.
*Smell:* a `catch {}` that swallows, a `|| true`, a fallback that masks a dead socket as "fine", a
parser that returns empty on malformed input where empty looks like "nothing to do."

**T17 · Deterministic, unified mechanism over a pile of special cases.**
Favor one mechanism that handles the family over many branches. Reliability comes from the harness, not
the agent's good behavior.
*Smell:* a growing `case`/`if` ladder where each arm is one current usage.

**T18 · Reversibility + cross-context audit over agent compliance.**
The scaffold's job is to make unreliability **cheap to detect and cheap to undo** — milestone-merges for
free rollback, a Stop-gate checkpoint, and an audit by a **different** context (a self-attested gate is
theater).
*Smell:* big-bang merges; a checkpoint the same context confirms; trusting a confident state declaration
without a fresh-context or loss-signal check.

### F. Self-reference, surface, method

**T19 · One design language; unify the glyphs; NO emoji in UI.**
The frontend speaks one symbol vocabulary (geometric/monochrome glyphs ✓ ✗ ⚠ ◆ → are the design
language). Decorative color emoji are retired.
*Smell:* a 📎 / 🔒 / ⏳ / 🚀 color-emoji in a rendered surface where a unified glyph or icon belongs.

**T20 · Self-reference + the outsider as contraction operator.**
Sediment every durable taste into spec / `.config` / source so it survives compaction; and institutionalize
a **fresh-context agent in every revision cycle** — the outsider supplies the entropy-removing pull a
self-referential loop cannot generate for itself. Resolve design debates by appeal to **externalized,
citable taste**, not by who argues better; let taste itself move only slowly and on stated grounds.
*Smell:* a self-model revised only by minds that already hold it; a guidance lost to chat compaction
because it never graduated into the tree; a debate won by rhetoric instead of a cited principle.

---

## §2 — THE 10 ISSUE-SELECTION CRITERIA

Operational gates a reviewer applies **mechanically** to decide KEEP (fix now, autonomously) vs DROP
(defer / needs a human). The maintainer's bar: KEEP only if it (a) reduces complexity without cutting
needed function or is a behavior-equivalent unification, (b) needs NO human decision, (c) is safe +
reversible. An issue must pass **C1–C5 (the KEEP gates) AND clear C6–C10 (the DROP traps)** to be kept.

### KEEP gates (all five must hold)

**C1 · Complexity-negative or behavior-equivalent.**
The change either removes a primitive/branch/dead-path, or unifies two paths into one with **identical
observable behavior**. Net new complexity for new behavior → not autonomous-KEEP.
*Mechanical test:* after the fix, is the branch/primitive/line count down, or behavior provably the same
through a YATU scenario? If neither, fail.

**C2 · No human decision required.**
No scope, outward-contract, schema, or roadmap call; no taste judgment only a human can make. The fix is
**determined** by an existing stated taste — you can cite the T# it satisfies.
*Mechanical test:* can you name the violated taste (§1) and is the correct end-state unambiguous? If the
fix has two defensible shapes, a human must pick → DROP.

**C3 · Safe + reversible.**
Bounded blast radius; a milestone-sized, cherry-pick-able commit; trivially revertible (T18).
*Mechanical test:* does it touch one node/module, and would `git revert` cleanly undo it? Multi-node
sweeps or data-migrations → DROP.

**C4 · Honest fix, not decorative.**
The fix changes **observable behavior at the surface** (bug fixed, dead interface removed, emoji gone),
verifiable by a test or a screenshot — not a comment tweak or a rename that no one can observe (T1).
*Mechanical test:* is there a before/after a YATU surface (or a parser round-trip) can show? If you
can't demonstrate the difference, it's not worth an autonomous fix.

**C5 · Collapses onto existing form.**
The fix is expressible as a correction/removal/unification within existing nouns — no new module,
concept, flag, or config key (T9/T10).
*Mechanical test:* does the diff introduce a new exported name, flag, or schema field? If yes → DROP
(it's a feature, not a de-drift).

### DROP traps (any one trips → DROP)

**C6 · Widens schema / outward contract / roadmap.**
Adds a yatsu/spec schema field, a CLI flag, an API endpoint shape, or a config key — or shifts what the
product promises.
*Trip:* new field in `spec.md` front-matter, new `spex` subcommand, new `/api/*` route, new `.config`
surface key.

**C7 · Removes a real feature or user-observable capability.**
"Simplification" that deletes behavior a user relies on is not de-drift (T9: don't use cleanup to remove
required behavior).
*Trip:* the diff deletes a code path that some scenario/user-story exercises.

**C8 · Is a judgment / taste call.**
Naming, UX wording, which-of-two-designs, or a principle the maintainer hasn't stated. Even a "smell" is
DROP if fixing it requires inventing the right answer.
*Trip:* you'd have to choose between equally-cited tastes, or no taste covers it.

**C9 · Unproven / not on the latest shared head.**
A failure that can't be reproduced on the current integration head is residue until re-proven (T13/T18:
prove through the surface). Speculative "might be broken" issues DROP until shown live.
*Trip:* no live repro; relies on a stale local head; or the "bug" is a misread spec.

**C10 · Crosses the semantic/mechanism line the wrong way.**
DROP a fix that adds a hard mechanism to police a **semantic** invariant only a mind can judge (T15), or
that hard-codes a one-off exception instead of improving the general mechanism (infra discipline).
*Trip:* a write-filter/validator that must "understand meaning"; an app-specific `if` added to shared infra.

---

## §3 — SEED ISSUE LIST (KEEP / DROP, with verdicts)

Concrete candidates spotted while reading. The two known codex bugs were **confirmed live** (sourced
`spec-cli/hooks/harness.sh`, ran the parsers). Verdicts cite the criteria.

### The two known codex bugs — both KEEP

**I1 · `harness.sh` multi-file apply_patch only annotates the FIRST file. — KEEP**
`_hp_codex_cmd_path` line 103 ends the patch-envelope path with `... | head -1`, so a multi-file codex
`apply_patch` (multiple `*** Update File:` markers) yields only the first path. **Confirmed live:** a
two-file patch (`src/a.ts`, `src/b.ts`) returned only `src/a.ts`. Effect: [[spec-of-file]] silently
skips every file after the first in a multi-file edit — an inert capability on the codex harness.
*Why KEEP:* C1 (behavior-equivalent fix toward the advertised contract), C2 (cite **T3** conformance-IS-
contract + **T16** no-silent-miss; correct end-state unambiguous — emit all paths), C3 (one line, one
file), C4 (provable via parser round-trip), C5 (no new noun). Fix shape: drop `head -1` and let the
caller iterate all `File:` paths (loop already exists at the call sites of `hp_code_path`).

**I2 · `hp_field` `[^"]*` truncates any value containing an escaped quote. — KEEP**
Line 12: `sed -n "s/.*\"$2\"...\"\([^"]*\)\"..."` stops the capture at the first `"`. **Confirmed live:**
`hp_field` on `{"command":"sed -n \"1,5p\" src/foo.ts"}` returned `sed -n \` — truncated at the first
`\"`. Effect: any codex `Bash` command or `apply_patch` envelope containing a quote (extremely common) is
truncated, so `_hp_codex_cmd_path` mis-parses the path and [[spec-first]]/[[spec-of-file]] miss the file.
This is the **root** of a whole class of codex-path misses (broader than I1).
*Why KEEP:* C1 (correctness fix, no new behavior), C2 (cite **T3** + **T16** — a silent fallback to a
wrong/empty value is exactly the fail-loud violation), C3 (one helper), C4 (parser round-trip proves it),
C5 (no new noun). Fix shape: make `hp_field` honor `\"` (match `(\\.|[^"\\])*` instead of `[^"]*`), or —
better per **T17** — parse the JSON-string value once with a proper unescape. Caveat: pick the smaller of
the two without widening (no jq dependency — keep it pure shell, **T6/T8** non-pollution).

### Emoji-in-UI smells (design language) — KEEP if a glyph already covers them

**I3 · Retire 📎 (paperclip) on the file-attach buttons. — KEEP**
`SessionInterface.jsx:794` and `:922` render `'📎'` (and `'⏳'` for the in-flight state) on both attach
surfaces; `styles.css:920` comments the `📎` button. Color emoji violate **T19** (one design language,
no emoji). *Why KEEP:* C1/C4 (observable surface change), C2 (T19 is stated verbatim in the raw taste —
"retire the attachment 📎"), C3 (local), C5 (swap the glyph). *Caveat / borderline:* choosing the
**replacement** glyph is a mild taste call (C8) — but the existing design language already has a geometric
vocabulary (avatar/keymap glyphs), so a unified attach/clip glyph is determined enough to stay KEEP. If no
glyph fits cleanly, downgrade to DROP-pending-human.

**I4 · 🔒 lock + ⏳ hourglass color-emoji. — KEEP (same fix family as I3).**
`SessionWindow.jsx:24` and `App.jsx:413` render `🔒`; `SessionInterface.jsx:794/922` render `⏳`. Same
**T19** violation, same verdict and caveat as I3. Bundle with I3 as one "retire color-emoji → unified
glyph" milestone.

> Note: ✓ ✗ ⚠ ◆ → ○ · and the avatar/keymap geometric glyphs are the **intended** monochrome design
> language (BoardStats, score, FocusPanel, SpecNode, Legend, avatar, keymap). They are NOT smells — do
> not "fix" them.

### Decorative-boundary / dead-code candidates — verify before KEEP

**I5 · Decorative adapter methods (audit). — KEEP each one that proves decorative.**
The challenge-01 finding ("the project's own 'decorative abstraction' finding") implies at least one
adapter method may type-check while lying. *Action for finders:* for each `Harness` method, run the same
YATU scenario on claude vs codex; any method whose deletion changes nothing observable on a harness either
(a) gets removed from the interface (T3 — KEEP, C1/C4) or (b) gets its missing impl filled. Removal is the
autonomous-KEEP path; **filling a missing capability is a feature → DROP** (C7/C6).

**I6 · Features holding no code of their own in sessions-core. — DROP (judgment + roadmap).**
`sessions-core/spec.md` itself flags that several features (state, launch, dispatch, comms-edge, graph,
selectors, spec-pointer) own no code — `sessions.ts` is "an honest signal it's a monolith." The
maintainer's own note says a future **code split** would let each reclaim ownership. *Why DROP:* that
split is a roadmap/scope decision (C6/C8), not a mechanical de-drift — even though it's a real
complexity-reduction it changes module boundaries a human should sequence.

**I7 · `slashCommands()` Claude-only / codex slash menu gaps. — DROP (feature work).**
harness-adapter notes the Claude `/` menu is captured but codex's is "the genuinely NEW Codex pieces."
Completing/extending it is **adding behavior** (C6/C7), not de-drift → DROP. Only KEEP a narrow sub-issue
if some advertised codex slash capability is decoratively inert (then it's an I5-style removal).

### Other smells spotted

**I8 · `resilience` / legacy compat shims — audit for dead branches. — KEEP only the provably-dead.**
lifecycle/runtime mentions "a bounded compat shim for legacy flat dotfiles." If a shim's legacy input can
no longer occur on the current head, deleting it is C1/C3/C9-clean (prove no live producer first). If any
producer remains → DROP (C7).

**I9 · Stale "today Claude-only" / "deferred" notes in specs that code has since closed. — KEEP per-note
when it's pure drift.**
Several specs carry "today X / deferred Y" qualifiers (slash-commands, codex reopen/thread-id capture). A
note that the code has **already** resolved is spec drift (T13) — correcting the prose to match shipped
code is C1/C2/C4-clean **iff** you verify the code actually closed it (C9). A note describing real
not-yet-done work is **not** a de-drift target → DROP. *Per-note verification required.*

**I10 · `harness-report.html` / one-off generated artifacts in the worktree root. — KEEP if machine-only.**
A `harness-report.html` sits at the repo root. If it's a generated, non-human-curated artifact it
violates **T14** (project folder = human-readable only) and should move to the global store or be
git-ignored. *Why conditionally KEEP:* C1/C4 (cleaner tree) — but verify it isn't an intentional
human-readable doc first (C9); if a human curates it, DROP.

**I11 · `~2KB tmux send-keys truncation` on codex `deliver()`. — DROP (known caveat, needs design).**
harness-adapter explicitly documents codex follow-up delivery as best-effort, short-only, with a ~2KB
send-keys truncation. Fixing it (chunking / a real channel) is **new mechanism / contract** (C6) and a
design call (C8) → DROP. It's a declared limitation, not drift.

**I12 · `_hp_codex_cmd_path` mutation detection by string-match on ` > ` / `tee` / `sed -i`. — DROP
(heuristic by design).**
The write-shape detection is acknowledged best-effort ("an exotic command may not resolve"). Hardening it
is open-ended judgment (C8) and risks new branches (C5/C10) → DROP unless a *specific* common shape is
provably mis-classified (then a narrow KEEP).

---

## Campaign use

Fan-out finders: apply §2 to every candidate; cite the §1 taste a KEEP satisfies and the §2 trap a DROP
trips. The bar is mechanical — if you can't name the taste and the criterion, it's not an autonomous
KEEP. The outsider/fresh-context agent (T20) is the certifier of every verdict, not the maintainer's
echo.
