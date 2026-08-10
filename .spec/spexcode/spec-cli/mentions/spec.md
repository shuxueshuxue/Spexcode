---
title: mentions
status: active
hue: 200
desc: Two universal in-text references - [[node]] (a topic) and @session (a retained session) - plus @new's explicit worker dispatch, parsed through one grammar in EVERY input box. CLI-first; the dashboard is a thin autocomplete over the same grammar.
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
  **`@new` is the one explicit worker action in the grammar:** after its containing write is durable, it creates
  a fresh worker through the same bounded session-create owner as every other creation request. `@new:<launcher>`
  selects that one worker's named launcher; an unknown name is reported in the dispatch outcome while the
  containing text remains stored. A spawned worker inherits the current thread's first node mention and records
  the writing session as its parent when that originator is a real board session.
- **The grammar is script-agnostic.** A reference token speaks the id vocabulary defined once in
  [[spec-lint]]'s id-format rule (unicode letters/numbers, `-`, optional leading dot) plus `_`, which occurs
  in minted parent-qualified ids. The parser and the autocomplete trigger scan use that same vocabulary, so
  CJK references are first-class.
- **The two never collide.** Topic is `[[]]`; session is `@`; the sole reserved `@` action is the exact token
  `@new` (optionally qualified by `:<launcher>`). Legacy `@<node>` prose is `[[node]]`. Creating/deleting
  nodes remain prompt-driven agent work.
- **Uniform in any input box, CLI-first.** The parser and `@new` dispatcher live in spec-cli, so issue prose,
  a composer, and an agent's own prompt share one grammar. The dashboard is one shared autocomplete module
  (`spec-dashboard/src/mentions.jsx`) consumed by every grammar-taking input: its `@new` row opens the same
  dashboard-visible launcher list used by New Session, and accepting a launcher writes the durable,
  inspectable `@new:<launcher>` token into the prose.
- **Actions stay explicit where their target is existing work.** `spex session send <id> "<message>"` is the
  sole session-to-session message action; `/distill <id>` inherits a finished, dead, or abandoned session.
  `@new` is the discoverable, durable shorthand for creating a fresh worker from the containing work item;
  `spex session new` and the New Session composer remain its direct creation peers.
- **In a CLI argument the sigil is optional, never banned.** In free text sigils separate references from
  prose. A CLI reference argument tolerates dashboard form: `spex review @graph` equals `spex review graph`,
  and `spex eval add [[cli-surface]]` equals `spex eval add cli-surface`. One shared `stripRefSigil` sheds a
  leading `@` or a full `[[...]]` wrapper without widening the underlying match.
- **The originator loop-in is separate.** A committed reply may send an online originator a courtesy copy over
  [[dispatch]]. It is not caused by an ordinary `@session` token, is never a spawn, and stays silent when its
  fallback chain is offline. The originator belongs to the thread: an issue author or an eval-comment reading
  filer ([[eval-core]]); a forge login resolves to nobody.
- **The `@` list is reference-ranked, not liveness-gated.** Retained sessions rank by exact/prefix id or
  headline, then recency, with the synthetic `@new` row available as the worker doorway. Offline rows remain
  available because investigation and `/distill` commonly need a completed session. Multiple `@session`
  references are ordinary prose and have no side effect; each exact `@new` token is one explicit spawn request.
