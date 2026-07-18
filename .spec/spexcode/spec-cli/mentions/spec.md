---
title: mentions
status: active
hue: 200
desc: Two universal in-text reference primitives — [[node]] (a topic) and @session (an actor that carries dispatch) — parsed the same way in EVERY input box. CLI-first; the dashboard is a thin autocomplete over the same resolver. First consumer is the issue store; adopted on more surfaces incrementally.
code:
  - spec-cli/src/mentions.ts#dispatchMentions
  - spec-cli/src/mentions.ts#parseMentions
  - spec-cli/src/mentions.ts#stripRefSigil
related:
  - spec-cli/src/mentions.test.ts
  - spec-dashboard/src/mentions.jsx
---

# mentions

## raw source

Referring to things inside prose should be **one grammar, everywhere** — the issue threads, the New Session box, an
agent's own prompt. There are exactly two kinds of referent: a **topic** (a spec node) and an **actor** (a
session/agent). Give each its own symbol so they never collide, and make the same parser resolve them in
every input box. The whole point an agent stated it plainly: **`@` just auto-sends a prompt** — so once the
grammar is uniform, the logic is tiny.

## expanded spec

- **`[[node]]` — a topic reference.** Resolves to a spec node; renders as a link that focuses it. **Passive**
  — naming a topic has no side effect. This is the Obsidian-style convention spec bodies already use
  ([[local-issues]] links nodes this way), promoted to a first-class, resolvable, autocompletable reference.
- **`@session` — an actor reference, and a HANDLE.** Resolves to a **live board session** and carries *what
  you can do to it*: watch it, or send it a prompt. **`@new`** is the special actor — dispatch a **fresh
  worker** (on the surface's node / the thread's node), optionally with a preset. Bare `@new` uses the
  configured default launcher; `@new:<launcher>` chooses one named [[launcher-select]] profile for this
  spawn. The qualifier belongs only to the synthetic `new` actor — session handles are unchanged. So an `@` in text is a
  contact you hand to a reader; what happens next is a **dispatch**, never a new datastore. **Any spawn's
  parent = its originator**: the `@new` worker records the mentioning author as its `parent`
  ([[session-nesting]]) so it folds under the session that summoned it — but only when that author IS a
  real board session id; a dashboard `human`, an `unknown` CLI author, or a forge login is no session →
  null parent, a top-level worker, never a phantom nest (the same no-sender rule `spex new` from a plain
  shell follows).
- **The grammar is script-agnostic, and its charset is not defined here.** A reference token speaks
  THE id vocabulary — the whitelist defined once in [[spec-lint]]'s id-format rule (unicode letters/
  numbers, `-`, optional leading dot; no uppercase Latin) — plus `_`, which never occurs in a dir name
  but does occur in a minted parent-qualified id ([[id-url-safe]]), so a minted `` [[.plugins_<id>]] ``
  mentions as one token. The same vocabulary slugify already grants branch/worktree names — so a CJK
  dir name is a legal node id and `[[中文节点]]` binds a launch exactly like an ASCII id, in the
  parser, the autocomplete's trigger scan, and the server's node derivation alike. An ASCII-only
  charset at ANY of those entrances breaks "one grammar, everywhere" in the worst way: the dropdown
  offers the node, the insert looks right, and the session silently launches node-agnostic.
- **The two never collide** because topic is `[[]]` and actor is `@` — no weighting, no third symbol, and no
  reserved verbs. Every legacy `@<node>` usage was **migrated to `[[node]]`**: the composer autocomplete + the
  board fresh-session key ([[session-console]] / [[term-input]]) and the server's node-derivation (`MENTION`).
  The old `@new`/`@delete` **server directives were deleted, not migrated** — creating or deleting a node is
  now prompt-driven agent work (the board chords prefill a plain instruction; the server never mutates the
  spec tree, see [[dispatch]]). So `@` names an actor, `[[]]` names a topic, and nothing else wears a sigil.
- **Uniform in any input box, CLI-first.** The parse + resolve + dispatch live in spec-cli (a `mentions`
  module), so an issue reply, the composer, and an agent's own CLI prompt all run the SAME resolver; the
  dashboard is a thin autocomplete over it — and that autocomplete is itself ONE shared module
  (`spec-dashboard/src/mentions.jsx`: the `[[`/`@` trigger scanners, the ranking, the dropdown), consumed
  by every dashboard input that takes the grammar (the console's New prompt and ❯ inbox, the issue
  composers), never re-implemented per surface. An agent `@`-ing another agent under an issue post is the
  identical path a human uses — **storage (the text) and delivery (the dispatch) stay separate**.
  Discoverability is symmetric: the dashboard hints via its autocomplete dropdowns — and the shared thread
  composer's action row carries two compact symbol buttons (`@` and `[[`) that insert the EXACT trigger at
  the caret (selection replaced, draft preserved, caret after the trigger, textarea refocused) so the SAME
  shared autocomplete opens naturally — a door to the grammar, never a second menu or dispatch path; the
  CLI hints via a
  mention line in `spex help session` and `spex help issues` — a CLI user must not have to find the
  grammar by reading the dashboard.
- **Launcher choice stays in the prose.** The shared dashboard autocomplete treats its synthetic `@new`
  row as a doorway to the configured launchers; picking one inserts `@new:<launcher> `, so the stored issue
  or remark says which worker identity was requested and the CLI can author the exact same text. A typed
  `@new:` filters that launcher list directly. Resolution carries the qualifier to [[launch]]'s existing
  launcher argument; a missing qualifier retains the default behavior, while an unknown name fails loud in
  the dispatch outcome. There is no composer-only launcher field and no second spawn API.
- **In a CLI argument the sigil is OPTIONAL, never banned.** In free text the sigils are what set a
  reference apart from prose, so they stay required there; but a CLI reference argument IS the reference,
  so it tolerates the dashboard-learned form: `spex review @graph` ≡ `spex review graph`, `spex eval add
  [[cli-surface]]` ≡ `spex eval add cli-surface`. One shared `stripRefSigil` (in this module, beside the
  parser) sheds a leading `@` or a full `[[…]]` wrapper — the session-selector matcher
  ([[session-selectors]]) applies it per comma-part, so EVERY selector-taking verb tolerates it at once,
  and each node-arg read site (eval add/retract/ls, `owner`, the `--node` flags) passes through it.
  Tolerance never widens matching: a stripped token matches exactly what the bare token matches, and a
  wrong sigiled token errors exactly like the bare one.
- **No new delivery pipe.** `@session` → [[dispatch]]'s `sendKeys` (a prompt = the surrounding text + a
  pointer to where it was written); `@new` → [[launch]]'s `newSession` (a fresh worker). Offline/unreachable
  fails loud (the `DispatchResult`), and the text still persists for the drain.
- **A reply has two delivery paths; only the explicit `@` is ASSIGNMENT.** Beside it, a committed reply
  gets an **implicit originator loop-in** — a *courtesy* copy to whoever ORIGINATED the thread, over the SAME
  resolution + `sendKeys`, delivered ONLY if they are online. Courtesy ≠ assignment: silent when offline
  (never a spawn or drain — only `@new` spawns), skipped when the originator is the replier or was already an
  explicit `@`-target. It carries the reply verbatim and is reported distinct from the `@`-dispatch. Who the
  originator is belongs to the *thread*: an issue author, or an eval-comment thread's reading-filer
  ([[eval-core]]) — a forge author is a github login resolving to nobody, silent by construction.
- **The drain guard: `@new` on a settled thread must not respawn its work.** Dispatch carries the thread's
  lifecycle status from the calling surface (the local store always knows it; a forge reply's state is
  unknown at write time — no guard there). On a non-open thread `@new` still spawns (the summons may be a
  deliberate audit), but with two cues, one rule in dispatch, no per-thread special-casing: the worker's
  prompt leads with the resolved status + verify-on-main-first-instead-of-re-implementing, and the poster's
  outcome line warns (`new→<id> ⚠ thread landed`).
- **The `@`-target list is relevance-ranked, active-only.** Candidates are the **online, governed** board
  sessions ([[state]] liveness), ordered: the surface's **owning agent if still active** → **active
  participants, most-recent first** → **`@new`** → **other active sessions** (self demoted). A
  closed/offline agent is absent — you don't summon a dead session; `@new` acts on its behalf. Multiple
  mentions per message are normal; what a mention *does* is whatever the surrounding text asks (often just
  "take a look").
