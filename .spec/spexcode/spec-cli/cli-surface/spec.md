---
title: cli-surface
status: active
hue: 200
desc: The spex command surface — porcelain-only top level grouped by loop, machine plumbing under `internal`, and a three-layer help journey (help → per-command help → guide).
code:
  - spec-cli/src/cli.ts
  - spec-cli/src/help.ts
related:
  - spec-cli/src/guide.ts
  - docs/AGENT_GUIDE.md
---
# cli-surface

## raw source

The `spex` top level is exactly the vocabulary a human or agent is meant to type — nothing more. A
verb only programs call (a generated hook, a launch script) does not sit beside the verbs people
learn; it lives under `spex internal`, out of sight. And no help probe may dead-end: from the map to
one command's usage to the guide, every layer names the next.

## expanded spec

**Porcelain-only top level.** `spex help`'s map lists every typeable command, grouped by the loop it
serves — *find & read the graph*, *author & verify* (the worker loop), *dispatch & manage sessions*
(the manager loop), *install & serve* (the operator loop) — so a newcomer learns not just what exists
but *when* each verb matters. Machine plumbing (`internal trunk` for the [[main-guard]] hook,
`internal codex-launch` / `internal codex-turn` for the [[harness-adapter]] launch script) is
namespaced under `spex internal`, absent from the map; its own usage text tells a stray human which
porcelain they probably wanted. Consequence of the move: a *stale installed* pre-commit hook that
still calls the old top-level token degrades to the hook's pure-git trunk fallback (advisory-safe),
and is healed by `npm run hooks`; the deprecated `spex propose` alias is gone the same way — a stale
post-merge hook prints one unknown-command line (advisory) until reinstalled. A *demoted* spelling
degrades more gently than a removed one: it stays as a **deprecated alias** that still runs but
echoes the canonical form on stderr, so a caller migrates without breakage (`spex review proof` →
`spex eval <SEL> --proof`, after proof was demoted from a review sub-noun to the export flag of the
[[review-proof]] eval read).

**The three-layer help journey** — each layer states what the next one is for, so the reader always
has a move:

1. `spex help` — the map. Also names the second layer (`spex help <command>`) and the guide topics.
2. `spex help <command>` / `spex <command> --help` — ONE command's usage: syntax, flags, semantics,
   a `see also:` pointing at its sibling verbs and guide topic, and a constant footer back to the map
   and the guide. The `--help` interception still fires BEFORE any verb runs ([[guide]]'s safety
   contract: probing `watch` or `session new` with `--help` must never start the verb) — what changed
   is that the probe now answers with *that command's* usage, not the whole map. Sub-namespace probes
   (`spex session send --help`) resolve to their namespace's entry; `resolve`/`retract` resolve to
   the `remark` entry they belong to.
3. `spex guide [topic]` — the skill layer ([[guide]]): workflows, file formats, settings. Guide pages
   footer back to `spex help`; the split is one sentence — **help answers "what do I type", guide
   answers "how do I work"**.

Dead-end rule: an unknown command, an unknown help topic, an unknown guide topic, and a bare
`spex internal` each fail loud AND name the layer to go back to — never a silent exit.

The map must stay honest: every porcelain verb `cli.ts` dispatches appears in it (a hidden typeable
verb is the bug this node exists to prevent — `search` and `owner` were exactly that), and each verb
with caveats carries them in its own entry (`watch` says it never exits and points at `wait`).
`cli.ts` remains the thin dispatch hub — verbs' logic lives in their own modules; help text lives in
`help.ts`; a sibling verb's churn in the hub is that feature's, not this node's drift.
