---
title: mentions
status: active
hue: 200
desc: Two universal in-text references - [[node]] (a topic) and @session (a retained session) - plus two explicit creation actions, @new's worker dispatch and @parent:'s supervisor addressing, parsed through one grammar in EVERY input box. CLI-first; the dashboard is a thin autocomplete over the same grammar.
code:
  - spec-cli/src/mentions.ts#parseMentions
  - spec-cli/src/mentions.ts#parseParentDirective
  - spec-cli/src/mentions.ts#stripRefSigil
related:
  - spec-cli/src/mentions.test.ts
  - spec-cli/src/mentions-command.api.test.ts
  - spec-dashboard/src/mentions.jsx
  - spec-dashboard/src/mentions.test.mjs
---

# mentions

## raw source

Referring to things inside prose should be one grammar everywhere - issue threads, the New Session box, and
an agent's own prompt. There are exactly two kinds of referent: a topic (a spec node) and a session. Give
each its own symbol so they never collide, and make the same parser resolve them in every input box.
References are not actions: a bare `@` only names a session. Sending a prompt, launching a worker, and
inheriting an abandoned session are explicit actions with their own verbs. Where an action IS part of the
grammar it wears a reserved qualified token, so reading a draft tells you which words will do something.

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
- **`@parent:<session>` is the second explicit action: it addresses the created worker's supervisor.** It
  answers a question `@new` can only answer by accident — a worker's parent is otherwise whoever happened to
  run the create, so a human launching from the dashboard could never hang one under an existing session at
  all. The selector is the ordinary session selector ([[session-selectors]]): full id, id prefix, or branch,
  optionally written after a space (`@parent: <sel>`) because that is how a hand types it. Being an action,
  it is consumed where the action happens — the create boundary strips it from the prompt, so the worker
  reads its task and not the addressing, and the id it resolves to is the record's durable `parent`
  ([[session-nesting]]). An explicit directive outranks the caller's own spawner provenance. One text names
  at most one supervisor: two different selectors, an unknown one, and an ambiguous prefix each fail the
  create loudly rather than landing a worker at top level where nobody would notice the miss.
  `@parent:` moves a session at BIRTH; [[session-reparent]] moves one that already exists.
- **The grammar is script-agnostic.** A reference token speaks the id vocabulary defined once in
  [[spec-lint]]'s id-format rule (unicode letters/numbers, `-`, optional leading dot) plus `_`, which occurs
  in minted parent-qualified ids. The parser and the autocomplete trigger scan use that same vocabulary, so
  CJK references are first-class.
- **The two never collide.** Topic is `[[]]`; session is `@`; the reserved `@` actions are the exact token
  `@new` (optionally qualified by `:<launcher>`) and the qualified `@parent:<session>`. Legacy `@<node>` prose
  is `[[node]]`. Creating/deleting nodes remain prompt-driven agent work.
- **Uniform in any input box, CLI-first.** The parser and `@new` dispatcher live in spec-cli, so issue prose,
  a composer, and an agent's own prompt share one grammar. The dashboard is one shared autocomplete module
  (`spec-dashboard/src/mentions.jsx`) consumed by every grammar-taking input: its `@new` row opens the same
  dashboard-visible launcher list used by New Session, and accepting a launcher writes the durable,
  inspectable `@new:<launcher>` token into the prose. `@parent` is its twin door and behaves identically —
  it re-opens the same ranked board behind the qualifier and writes `@parent:<full-id>` — so a human never
  has to know a session id by heart to nest a launch. Both doors write TEXT: the browser posts the raw draft
  and never resolves a selector or sets a `parent` field of its own. The same hook also carries a host's `/`
  palette when the host arms one (the session console's board/preset/harness commands, the launch presets), so no input box
  keeps a second menu machine beside the grammar, and the session-send twin of launch resolution —
  `[[node]]` expanded to its live spec pointer — is one exported function every live-session composer calls.
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
  headline, then recency, with the synthetic `@new` and `@parent` rows available as the two action doorways.
  Offline rows remain available because investigation and `/distill` commonly need a completed session, and
  because a supervisor may legitimately be a session that has already stopped. Multiple `@session`
  references are ordinary prose and have no side effect; each exact `@new` token is one explicit spawn request.
