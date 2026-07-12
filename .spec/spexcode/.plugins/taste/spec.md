---
title: taste
status: active
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

## expanded spec

This node is the seed. The de-drift campaign distills these into a sharper checklist (the "20 tastes" + the
issue-selection criteria), audits the tree against them, and graduates the agent-governing ones into
`.plugins` surface:system so every launched agent inherits them. Until then, this node is the durable record —
read it when a design decision needs the project's own taste, and add to it (raw source first) when the
maintainer states a new one.
