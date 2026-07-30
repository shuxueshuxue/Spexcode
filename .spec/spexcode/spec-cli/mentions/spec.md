---
title: mentions
status: active
hue: 200
desc: Two universal passive in-text references - [[node]] (a topic) and @session (a retained session) - parsed the same way in EVERY input box. CLI-first; the dashboard is a thin autocomplete over the same grammar.
code:
  - spec-cli/src/mentions.ts#parseMentions
  - spec-cli/src/mentions.ts#stripRefSigil
related:
  - spec-cli/src/mentions.test.ts
  - spec-cli/src/mentions-command.api.test.ts
  - spec-dashboard/src/mentions.jsx
---

# mentions

## raw source

Referring to things inside prose should be one grammar everywhere - issue threads, the New Session box, and
an agent's own prompt. There are exactly two kinds of referent: a topic (a spec node) and a session. Give
each its own symbol so they never collide, and make the same parser resolve them in every input box.
References are not actions: `@` only names a session. Sending a prompt, launching a worker, and inheriting an
abandoned session are explicit actions with their own verbs.

## expanded spec

- **`[[node]]` is a passive topic reference.** It resolves to a spec node and renders as a link that focuses
  it. This is the Obsidian-style convention spec bodies already use, promoted to a first-class,
  resolvable, autocompletable reference.
- **`@session` is a passive session reference and handle.** It names one retained board session, including an
  offline one. Autocomplete inserts the stable full id rather than a display label. The receiving agent may
  inspect it, run `/distill <id>`, or deliberately send it a message with `spex session send <id>`. Mentioning
  it never reads its transcript, appends to its log, wakes its harness, creates a worker, or changes state.
  `@new` and `@new:<launcher>` have no special meaning: create workers with `spex session new` or the New
  Session composer.
- **The grammar is script-agnostic.** A reference token speaks the id vocabulary defined once in
  [[spec-lint]]'s id-format rule (unicode letters/numbers, `-`, optional leading dot) plus `_`, which occurs
  in minted parent-qualified ids. The parser and the autocomplete trigger scan use that same vocabulary, so
  CJK references are first-class.
- **The two never collide.** Topic is `[[]]`; session is `@`; no action gets a sigil. Legacy `@<node>` prose
  is `[[node]]`. Creating/deleting nodes and launching workers are prompt-driven or explicit session actions.
- **Uniform in any input box, CLI-first.** The parser lives in spec-cli, so issue prose, a composer, and an
  agent's own prompt share the grammar. The dashboard is one shared autocomplete module
  (`spec-dashboard/src/mentions.jsx`) consumed by every grammar-taking input. Storage is the only consequence
  of writing a reference: it remains visible to the reader who chooses the next action.
- **Actions stay explicit.** `spex session send <id> "<message>"` is the sole session-to-session message
  action; `spex session new` / the New Session composer creates workers; `/distill <id>` inherits a finished,
  dead, or abandoned session. These verbs make an interrupting or expensive effect visible before it happens
  instead of hiding it behind ordinary prose.
- **In a CLI argument the sigil is optional, never banned.** In free text sigils separate references from
  prose. A CLI reference argument tolerates dashboard form: `spex review @graph` equals `spex review graph`,
  and `spex eval add [[cli-surface]]` equals `spex eval add cli-surface`. One shared `stripRefSigil` sheds a
  leading `@` or a full `[[...]]` wrapper without widening the underlying match.
- **The originator loop-in is separate.** A committed reply may send an online originator a courtesy copy over
  [[dispatch]]. It is not caused by an `@` token, is never an assignment or spawn, and stays silent when its
  fallback chain is offline. The originator belongs to the thread: an issue author or an eval-comment reading
  filer ([[eval-core]]); a forge login resolves to nobody.
- **The `@` list is reference-ranked, not liveness-gated.** Retained sessions rank by exact/prefix id or
  headline, then recency. Offline rows remain available because investigation and `/distill` commonly need a
  completed session. Multiple references are ordinary prose and have no side effect.
