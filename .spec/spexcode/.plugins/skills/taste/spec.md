---
title: taste
status: active
seed: false
surface: skill
hue: 50
desc: SpexCode's engineering taste — load when making a design/architecture decision, weighing whether a change is worth its complexity, or sanity-checking work against the project's principles (harness-agnostic zero-friction adoption, spend-complexity-only-to-buy-it-back, one unified mechanism over special-cases, self-launch-is-the-main-body).
---

# taste

## raw source

SpexCode is **self-referential** — we build a spec-driven tool *with* the spec-driven tool, so the principles
that guide its development must themselves live in the spec tree, not only in a chat that can be compacted away.
These are the durable "tastes" (品味) the maintainer has stated while building it. Preserve the raw intent; let
the campaign distill + refine, and let the rules that should govern every agent graduate into `.plugins`
surface:system nodes (the way [[memory-hygiene]] already did).

The principles, in the maintainer's own framing:

1. **Harness-agnostic, zero-friction adoption.** The ideal path is `npm install spexcode` → `spex init` →
   the user launches their own `claude`/`codex`, with NO further human operation, NO pollution of global
   claude/codex, and NO overwrite of the user's existing CLAUDE.md / AGENTS.md content.
2. **Deterministic, simple, UNIFIED system — not tons of special cases.** Favor one mechanism over many
   `if/else` branches.
3. **Spend complexity only to BUY it back.** A user need earns a code change ONLY when satisfying it
   *reduces* system complexity, or you have a clever way to make it a complexity-reducer — never "one more
   if-else." Don't add complexity trading for a need.
4. **The project folder holds only human-readable things.** Abstract internal runtime (manifests, hashes,
   locks) is hidden into the global store; what stays in-tree must be prose a human would accept.
5. **Self-launch is the MAIN BODY.** A user on the most naive Claude Code / a directly-launched Codex — NO
   dashboard, NO server — must still get the FULL experience (prompt, hooks, every mechanism) through
   `spex init`/`spex spec lint` + materialize→auto-discovery. The dashboard is one consumer that REDUCES to that
   path plus a minimal governed delta. Adapting to this "unmanaged" usage is the forcing function that makes
   the architecture robust and unified — the point is NOT to add if-else per usage mode (that loses the forcing).
6. **Memory hygiene** ([[memory-hygiene]]): never write session/role-specific content or identity markers to
   the project-keyed memory — by instruction, not programmatic control (no 画蛇添足).
7. **Use fresh-context agents** to brainstorm, confront, debate, and divide labor — they are less overfit,
   carry a naive taste, and dare to challenge the architecture. They are also a **complexity probe**: if a
   fresh agent can't understand the spec↔code relationship, grasp what the code is for, or round-trip
   spec→code→spec, that misalignment IS the measurement. Don't drag a huge context and brute-force solo.
8. **Read the docs, read the source, run experiments.** Many mechanisms are only understood after
   experimenting; the codex source reveals the least-convoluted, most-claude-unified implementation. Don't
   reason from assumption.
9. **Milestone merges, not big-bang** — land work in versioned milestones so a rollback is cheap.
10. **One frontend design language; unify the icons; NO emoji** (e.g. retire the attachment 📎).
11. **Keep finding behavior-equivalent but simpler / more-unified approaches**, and sanity-check every change
    against these existing principles.
12. **Self-reference**: sediment this guidance into the spec / `.plugins` / source so it is never lost.
13. **YATU** (You As The User): measure through the real product surface a user touches, not an internal helper.
14. **Capabilities enter the ecosystem through the pillars we already stand on** (git / agent harness / test
    framework) — before adopting a new protocol or dependency, check whether an existing pillar already
    delivers it indirectly. The canonical case: LSP-grade code intelligence reaches SpexCode *through the
    harness* (agents navigate code; the LLM judge reads semantics) and symbol-level history *through git*
    (`log -L`, hunk-header funcname drivers) — so SpexCode never speaks the LSP protocol itself. A capability
    worth having usually has a pillar-native form; integrating it directly is how tools bloat.
15. **Each pillar gets exactly ONE adapter seam.** The maintainer's framing: "harness adapter, language
    adapter, test framework adapter — 我们最终会拥有这三方面的适配". Harness adapter exists (`harness.ts` +
    launchers + materialize); language adapter is the anchor/coverage extraction seam; test-framework adapter
    is where eval evidence producers will plug in. Every seam shares one shape: an interface + an ordered
    registry + per-instance DATA rows (a new harness/language/runner is a row, not a branch), loud degradation
    when a tier is unavailable — and product semantics never learn which adapter sits on the other side.
16. **Don't invent what the pillar isn't prepared for.** The maintainer's framing: "不要擅自发明 git 没有准备
    好的东西". Stated when rejecting an explicit node-identity field to make rename tracking provable: git
    *detects* renames by content similarity rather than *recording* them, so an id field would erect a second
    identity model beside git's object model — two truths to keep in sync, and no way to know which to believe
    the first time they disagree. The consequence is accepted deliberately: we live inside git's rename
    semantics, and therefore the acceptance bar is "agrees with git's rename events across the whole tree",
    not "provably correct in some model git does not have". This is [[taste]] 14 applied to the seam itself —
    a pillar's *limits* enter the ecosystem along with its capabilities.
17. **Where the application-level call is genuinely unclear, let implementation simplicity decide.** The
    maintainer's framing: "对于这种应用层拿不准的地方，我们就从自己的实现角度考虑，哪种实现最简单就怎么来".
    Not a tie-breaker to reach for early — it applies precisely when the product argument has been made in
    good faith and stays balanced. Then the honest question is which option costs less mechanism, and the
    answer is often that one of them is already the behaviour and costs zero lines.
18. **Stabilise first, then measure the shape of the cost — not just its size.** The maintainer's framing:
    "先保证稳定，然后计算一下复杂度，是线性还是平方级，和 git 历史长度是否有关，还是说只和文件数目有关".
    A wall-clock number tells you a run was slow; the scaling dimension tells you which lever exists. The
    same 4-second lint means opposite things if it grows with history (nothing local can fix it) versus with
    source bytes (memoisation applies) versus with node count (the walk is wrong). Measure the dimension
    before designing the fix, and never buy a cache before knowing whether the work is repeated at all.

19. **Separate what is PERMANENT from what is CURRENT, and let the invalidation scope be derived, not
    assigned.** Git history is append-only: what a commit changed, what trailers it carries, what a merge
    itself authored are *permanent properties of that commit* — they can be accumulated once and never
    recomputed. What those facts mean *today* — which node owns a path after renames, which window a
    version opens — is a question about the current tree, and is cheap. The costly half is permanent; the
    tip-relative half is cheap. A read that recomputes the permanent half from scratch pays O(history)
    forever, so the project gets slower every day it is worked on — measured here as ~0.33 ms per commit
    across two full-history walks. The same confusion at the cache layer produces a worse failure: when a
    rebuild costs more than the interval of the watchdog that guards it, every finished rebuild is
    invalidated before it can be served, and a safety net becomes a latency amplifier — the fix is to make
    the rebuild cheap, never to lengthen the interval, which only moves the threshold. The corollary is
    about *scope*: derived data spread across several projections (board, review snapshot, session eval
    revision) has no single place declaring what depends on what, so an invalidation scope ends up
    hand-assigned by whoever traced the call chain last — and the honest default becomes "invalidate
    everything". Cheap correctness there comes from letting a projection *declare its inputs*, so the scope
    follows from the declaration; until it does, narrowing a scope by inspection is a correctness change
    disguised as a performance one, and must be proven field-by-field against a full recompute. Keep the
    slow, obviously-correct full recompute in the repo as the specification, and hold every faster path to
    byte-equality against it.

## expanded spec

This node is the seed. The de-drift campaign distills these into a sharper checklist (the "20 tastes" + the
issue-selection criteria), audits the tree against them, and graduates the agent-governing ones into
`.plugins` surface:system so every launched agent inherits them. Until then, this node is the durable record —
read it when a design decision needs the project's own taste, and add to it (raw source first) when the
maintainer states a new one.
