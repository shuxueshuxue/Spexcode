# FireCoder → SpexCode scouting report

**Task:** reconnaissance only. Read the FireCoder research notes
(`/root/Codebase/research/auto-review/firecoder-site/site/`, ~16 HTML pages + `notes/`, `design-v1.html`)
and report what is worth integrating into SpexCode. **No implementation.**

**One-line finding:** FireCoder and SpexCode are the same idea built by two teams. They converge on
"a spec is a living, agent-maintained lockfile for code intent." SpexCode is ahead on *graph plumbing*
(git-as-database, no stored hashes, node-graph dashboard, dogfood ritual, session machine). FireCoder
is ahead on *content judgement* — it built and **validated** the exact thing SpexCode reserved a slot
for and left empty: an **LLM judge that re-derives behavior from code and compares it to intent**, plus
a **frozen spec-quality rubric**. The top borrowables fill SpexCode's content-judgement gap; SpexCode
should *not* copy FireCoder's hash/attestation anti-cheat machinery (it already solved that better).

---

## The seam that makes this matter

SpexCode already drew the dividing line and left one half unbuilt:

> `lint.ts:6` — "keeps the spec<->code **GRAPH** honest (the judge keeps the **CONTENT** honest, elsewhere)"
> `spec-lint/spec.md:17` — "whether the code still matches what the spec *says* is **the LLM judge's job,
> async, not in the commit path.**"

There is **no judge in the tree** (`grep -rin judge` over `src/` finds only these two comments). Lint
checks five structural rules — `integrity`, `living`, `coverage`, `drift`, `altitude` (`lint.ts:97-156`) —
none of which read whether the code *means* what the spec *says*. FireCoder's whole research line is that
missing judge, already built and measured on real SWE-bench repos. That is why this is worth a careful read
rather than a glance.

---

## Borrowable ideas (each: concept+source → SpexCode mapping → value/effort)

### 1. Blind round-trip + LLM judge for **content drift** ★ TOP PICK
- **FireCoder concept & where:** `01-spec-lockfile-design`, `04-glm-claude-code-trace`, `11-spec-maintainer-flow`.
  A **fresh-context subagent** is handed *only the path* to the governed file(s) — never the human's intent,
  never code pasted by the (untrusted) main agent — reads the file itself, and **reverse-derives the behavior**
  ("round-trip" / `spec'`). A **judge** then compares `spec'` against the pinned intent and returns a **binary
  verdict + one-line reason** (consistent / not-consistent). Validated in a real GLM-in-Claude-Code trace
  (`04`): the subagent's only tool call was `Read`; a deliberately-wrong intent was *caught* and the spec
  correctly refused to go green. Hard-bench result (`13`): **14/14 confirmed regressions caught** where the
  spec links the changed code; **0/4 false alarms** on behavior-preserving refactors.
- **Maps onto SpexCode:** This **is** the "LLM judge, async, not in the commit path" that `spec-lint/spec.md:17`
  already promises. The anchor it needs already exists — the `code:` frontmatter list (`lint.ts:107-113`) is
  exactly "which files to hand the subagent." The trigger already exists — the `drift` rule
  (`lint.ts:150-153`, derived live from `git rev-list`) already says *which* nodes' code moved ahead of their
  spec, i.e. exactly the nodes worth re-judging; the judge is the natural escalation of a drift warning from
  "maybe stale" to "stale, and here's why." The subagent harness already exists — `sessions.ts` launches
  fresh-context workers. The judge would surface as a new node state / dashboard badge next to `drift`.
- **Integration constraints (non-obvious, important):**
  - **Do NOT store the verdict in the spec body.** `three-part-body/spec.md:18-21` *bans* any agent-authored
    "current state" or "verdict" section — "progress is DERIVED, never narrated." FireCoder stores its
    `<judge>` block *inside* the spec file; SpexCode must keep the verdict **outside** the body (a cached
    derived artifact, a git-committed sidecar, or recomputed on demand — consistent with "git is the
    database, no stored hashes," `source-of-truth/spec.md:24`).
  - **Use the mechanism, not the attestation.** FireCoder also offers `--roundtrip-by-subagent y/n` flags that
    *trust the agent to self-declare* honesty (`07-scripts-final-design`). SpexCode's separation-of-powers
    (below) is stronger: a separate subagent with **no write affordance** to the verdict. Adopt the subagent
    isolation; skip the self-attestation flags.
- **Value / effort:** **Value: very high** — it completes the product's value proposition (the graph is
  already honest; the *content* is currently unchecked). **Effort: medium-high** — needs a judge-runner
  (reuse the worker-launch path), a "path-only, read-it-yourself" subagent prompt, and a verdict cache that
  respects the no-stored-state discipline. The async/out-of-commit-path framing keeps it off the hot path.

### 2. Frozen spec-quality rubric to upgrade `altitude` (the "thin" axis especially) ★ TOP PICK
- **FireCoder concept & where:** `12-spec-quality-standard`, `14-research-method`. A **frozen, model-robust
  LLM rubric** scoring a spec's *writing quality* on 5 dimensions, 1–5 each (/25): **declarative**,
  **refactor-resistant**, **edges/errors**, **testable**, **concise** (`<25%` of code length). Two **red-line
  gates**: `declarative ≤2` or `refactor_resistant ≤2` ⇒ hard FAIL. The objective core is the
  **contract-surface test**: *"could a behavior-preserving refactor delete or change this token?"* Yes ⇒
  implementation leak, cut it (`open()`, `'rb'`, "added a parameter"); No ⇒ contract surface, keep it (public
  names, signatures, caller-visible behavior). Output is structured JSON (`gate`, per-dim `scores`,
  `implementation_leaks`, `top_fixes`, `rewrite`). Achieved **100% gate-agreement** with a human oracle on a
  held-out set; frozen and re-runnable by any model with no hosted service.
- **Maps onto SpexCode:** This is the LLM-judge version of `altitude` (`lint.ts:56-95`). Altitude today fires
  on **cheap regex proxies** — line/char budget, code-identifier density >1.3/line, ≥3 step-by-step lines —
  a deliberate, honest choice because it runs *in the commit path*. The rubric is what you run **async**
  (same lane as #1) for a real quality grade. The **contract-surface test is a near-verbatim restatement of
  SpexCode's own `three-part-body` rule** ("expanded spec is the agent's behavioral understanding — *not*
  implementation"). Critically, the rubric adds an axis altitude **structurally cannot detect**: altitude
  only catches a body sliding *too low* (mechanics dump); it is blind to a body that is *too vague /
  incomplete* — FireCoder's "**thin**" signal (`13-hard-bench-report`: gate=is-it-HOW, thin=vague/incomplete,
  link-gap=coverage). Surface as a per-node "body quality" health badge in the dashboard NodeView (which
  already renders parts with owner badges, `three-part-body/spec.md:39-43`), and feed the rubric's `rewrite`
  output to the existing `/tidy` slash config (`.config/tidy`).
- **Crucial design lesson (FireCoder learned it the hard way — `10-experiments`):** a hard gate on a *measured
  artifact* backfires — when they made spec-length a hard gate, agents **hand-edited the round-trip to game
  the metric** (fidelity dropped to 0.33–0.69). Fix: "gates should enforce **invariants**, not optimize
  **metrics**." SpexCode is already on the right side of this — `altitude` is a **warn**, not an error
  (`lint.ts:132`). Keep the quality rubric **advisory** (a health badge), never a commit-path hard gate.
- **Value / effort:** **Value: high** — directly upgrades a rule SpexCode already cares about and adds the
  missing "too vague" axis. **Effort: medium** — a prompt + the same async judge-runner as #1; the
  contract-surface test is already SpexCode philosophy, so the rubric is mostly capturing existing taste.

### 3. "link-gap" as a coverage/completeness health signal ★ #3
- **FireCoder concept & where:** `13-hard-bench-report`, `14-research-method`. Three **orthogonal** health
  signals computed *separately from* the frozen judge: **gate** (is it HOW?), **thin** (vague/incomplete?),
  **link-gap** (does the spec link *every changed file*?). Headline number: **41% of specs under-link
  (11/27)** — and link-gap is the documented reason drift-detection silently *misses* (2/2 misses were
  spec-doesn't-link-the-changed-file). The lesson: a frozen judge can stay frozen while the system keeps
  *adding orthogonal checks around it*.
- **Maps onto SpexCode:** SpexCode has **coverage** (orphan files — a *file* claimed by no spec, `lint.ts:144-145`)
  and **drift** (stale by git ancestry). It has **no** "does this PR's diff stay within the linked node's
  `code:` list?" check. The raw material already exists: `spec-forge/links` resolves PRs → nodes via the
  `Spec: <id>` marker and PR branch (`links/spec.md:16-23`), and `git.ts` already walks per-file history for
  drift. Combining "this PR/session changed files X,Y,Z" with "the linked node's `code:` covers {…}" yields a
  per-session **link-gap** badge — a finer-grained, change-scoped sibling to coverage. Natural home: a "graph
  health" panel on the dashboard, or a new advisory lint finding.
- **Value / effort:** **Value: medium** — explains *why* a future judge would miss real drift (unlinked
  changed files), so it pairs with #1. **Effort: low-medium** — reuses the forge link resolver + git diff;
  no new judge needed.

### 4. Separation of powers — verdict must be unforgeable-by-mechanism (design constraint, not a feature)
- **FireCoder concept & where:** `11-spec-maintainer-flow`, `04`. Main/dev agent **owns intent**; a fresh
  subagent (the "maintainer") **compiles the judge**, which is **read-only to main** — main has *no sanctioned
  path* to declare its own spec "passing." Honest bound on a shared filesystem: "no affordance + detectable if
  forged," not cryptography.
- **Maps onto SpexCode:** SpexCode already embodies this instinct in two places — the **two-part owner model**
  (human owns `raw source`, agent owns `expanded spec`, `three-part-body/spec.md`) and the **doer-proposes /
  manager-merges** split where "the doer never merges itself" (`CLAUDE.spexhidden.md:13`). FireCoder's rule is
  the same principle applied to the *judge verdict*: the worker that wrote the code must not be the process
  that declares it consistent. This is the governing **constraint on how #1 is built**, not a separate
  deliverable — log it so the judge isn't accidentally made self-declarable.
- **Value / effort:** **Value: high but as a constraint on #1.** **Effort: n/a** (it shapes #1's design).

### 5. Whole-tree spec-maintainer (dedup / compress / organize)
- **FireCoder concept & where:** `11-spec-maintainer-flow`. *One* maintainer subagent (not one-per-spec) sees
  the **whole `.spec/` tree at once**, so beyond per-spec verification it can **compress bloated specs**,
  **dedup/merge overlapping specs**, and tidy the tree — fresh context also clears the dev agent's
  "I-just-wrote-this" bias.
- **Maps onto SpexCode:** Extends the existing per-node `/tidy` slash config (`.config/tidy` — "rewrite a
  node's body to contract altitude") from single-node to **tree-wide**, adding a dedup/merge capability
  SpexCode lacks. Fits the reflexive `.config` system as a new `surface: slash` plugin.
- **Value / effort:** **Value: medium** (more speculative — overlap/dedup is rarer than drift). **Effort:
  medium-high** (whole-tree reasoning + merge proposals that respect the dogfood ritual). A later-phase idea.

### 6. Research/validation methodology for shipping a trustworthy judge
- **FireCoder concept & where:** `05-benchmark-design`, `13`, `14`. Discrimination over pass-rate
  ("flags bad, leaves good"); **GOOD/BAD pairs** (hand-crafted subtle drifts + real SWE-bench base→head),
  reported separately; metrics = detection rate / false-alarm rate / both-pass rate; **3 repeats + majority
  vote** for a stochastic judge; **blind + frozen** oracle, **held-out** tuning sets, **flip-rate** as the
  model-robustness measure ("read the margin, not the flip count"; "match sample size to rarity"). And the
  meta-lesson: they **measured a deterministic code-token scanner as a control** and found it *false-fired on
  clean specs* (`attempts=3` read as a call) — "decouple measurement from artifact; verify, don't assume."
- **Maps onto SpexCode:** Not a feature — it's the **rigor recipe for validating #1 and #2 before trusting
  them**. SpexCode currently has *no* measurement of its own dogfood loop's quality; this is how you'd earn
  confidence in a judge rather than asserting it. Also a direct caution for #2: don't bolt a regex code-token
  detector onto altitude as "free insurance" — FireCoder measured that exact idea and it hurt.
- **Value / effort:** **Value: high as process** (de-risks #1/#2). **Effort: research, not a build.**

---

## Explicitly DON'T borrow (SpexCode already solved these better)

- **Stored content hashes (git-blob-hash, intent-hash).** FireCoder pins code + intent with SHA1 blob hashes
  in the spec file (`02`, `07`). SpexCode's **core architectural choice is the opposite** and cleaner: "no
  file hashes are stored — git already is the hash database, so drift is derived live" (`lint.ts:14`,
  `source-of-truth/spec.md:24`). Importing hashes would regress SpexCode's design.
- **Attestation flags & compare-and-swap intent token** (`--subagent-read-spec y/n`,
  `--roundtrip-by-subagent y/n`, `--change-intent <hash>`, `07`/`08`). These trust a non-adversarial agent to
  self-declare honesty on a shared filesystem. SpexCode replaces this whole category with **mechanism**: the
  `prepare-commit-msg` hook stamps the `Session:` trailer, `main-guard` blocks self-merges, the `Spec-OK:`
  trailer (`spec-lint/spec.md:52-65`) is the auditable git-native counterpart to "intent change." Keep the
  git-trailer approach.
- **Copy-guard via difflib novelty threshold** (`07`). An anti-cheat for a Python CLI without git provenance;
  unnecessary when every change is a reviewed, attributed git commit.
- **Per-repo HTML console generator** (`06-repo-console-design`). SpexCode's React node-graph dashboard +
  history/recent tabs already exceed this. The only transferable sub-idea is the **eval/health panel** (a
  metrics surface), which is what #3 proposes.

---

## Ranked recommendation

| # | Idea | Fills SpexCode gap | Value | Effort |
|---|------|--------------------|-------|--------|
| **1** | **Blind round-trip + LLM judge (content drift)** | the explicitly-reserved, empty "LLM judge" slot | **very high** | medium-high |
| **2** | **Frozen spec-quality rubric (adds the "thin/vague" axis)** | `altitude` can't see "too vague"; no real quality grade | **high** | medium |
| **3** | **link-gap health signal** | no change-scoped coverage check; explains judge misses | medium | low-medium |
| 4 | Separation-of-powers (verdict unforgeable) | — (design constraint on #1) | high *as constraint* | n/a |
| 5 | Whole-tree maintainer (dedup/compress) | no cross-node dedup | medium | medium-high |
| 6 | Judge-validation methodology | no measurement of the loop | high *as process* | research |

**Do #1 and #2 together** — they share one async judge-runner harness and one design principle (judge runs
off the commit path, verdict stored outside the body, produced by an isolated subagent). #1 judges
*code-vs-spec* (drift in meaning); #2 judges *spec-vs-good-writing* (the contract-surface rubric). Together
they are the "judge keeps the CONTENT honest" half that `lint.ts:6` names and the tree does not yet contain.
**#3** is the cheap follow-on that tells you when #1 is structurally blind. Everything else is design
guidance (#4, #6) or a later phase (#5).

**Hard constraints any implementation must honor** (where FireCoder's design and SpexCode's collide):
1. Verdicts live **outside** the spec body — `three-part-body` bans narrated state/verdict sections.
2. No stored hashes — derive from git, per `source-of-truth`.
3. Judge is **async / off the commit path** and **advisory** — `altitude`'s warn-not-error discipline plus
   FireCoder's own "hard gates on measured artifacts get gamed" finding (`10-experiments`).
4. The judging subagent has **no write affordance** to its own verdict (separation of powers).
