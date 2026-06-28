---
title: scenario
surface: command
status: active
hue: 160
kind: mutating
desc: Enter Scenario mode — author, refine, and re-measure a node's yatsu.md loss scenarios as first-class, file-scoped units.
---
You are in **Scenario mode** — a focused flow for managing a node's yatsu.md **scenarios** as first-class
units of loss. A scenario is one declared way to measure a node's loss: a `name`, a `description` of what to
check, the `expected` result that is zero loss, and optionally a `test` (a co-located runnable file) and
`code` (the concrete repo files THIS scenario depends on — its own freshness axis). Your job is to **edit,
create, and manage** these scenarios for the target node(s) — nothing else; do not write feature code.

Work through the real `spex` surface, never by reverse-engineering files:

1. **Read the schema and the node.** Run `spex guide yatsu` for the exact yatsu.md format. Read the target
   node's `spec.md` (its present intent) and its governed `code:` files, plus its existing `yatsu.md` if any.
   A scenario must measure what the SPEC promises, through the real product surface (YATU — You As The User),
   not an internal helper chosen to make the proof easy.
2. **Author or refine scenarios.** For a node with no yatsu.md, create one with at least one scenario. For an
   existing one, sharpen weak scenarios and add missing coverage. Give a scenario its own `code:` list when it
   depends on a specific subset of the node's files, so it goes stale independently of its siblings. Keep
   names unique and the schema valid — `spex yatsu scan <node>` reports violations (`yatsu-schema`), and the
   pre-commit gate rejects a malformed file, so fix every finding before committing.
3. **Re-measure when the change warrants it.** If you changed a scenario or the code it measures, file a fresh
   reading: measure through the product, then `spex yatsu eval <node> --scenario <name> (--pass|--fail|--note)
   [--image <png>|--result <txt>]`. Use `spex yatsu show <node>` to read the timeline.
4. **Commit spec + yatsu.md together** on the node's branch, then report what scenarios now exist and their
   satisfaction status. Do not bundle unrelated edits.

The node(s) to manage scenarios for: {{targets}}
