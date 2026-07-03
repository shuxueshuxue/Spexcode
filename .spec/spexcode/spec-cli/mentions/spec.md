---
title: mentions
status: active
hue: 200
desc: Two universal in-text reference primitives — [[node]] (a topic) and @session (an actor that carries dispatch) — parsed the same way in EVERY input box. CLI-first; the dashboard is a thin autocomplete over the same resolver. First consumer is the forum; adopted on more surfaces incrementally.
code:
  - spec-cli/src/mentions.ts
  - spec-cli/src/mentions.test.ts
  - spec-dashboard/src/mentions.jsx
---

# mentions

## raw source

Referring to things inside prose should be **one grammar, everywhere** — the forum, the New Session box, an
agent's own prompt. There are exactly two kinds of referent: a **topic** (a spec node) and an **actor** (a
session/agent). Give each its own symbol so they never collide, and make the same parser resolve them in
every input box. The whole point an agent stated it plainly: **`@` just auto-sends a prompt** — so once the
grammar is uniform, the logic is tiny.

## expanded spec

- **`[[node]]` — a topic reference.** Resolves to a spec node; renders as a link that focuses it. **Passive**
  — naming a topic has no side effect. This is the Obsidian-style convention spec bodies already use
  ([[proposals]] links nodes this way), promoted to a first-class, resolvable, autocompletable reference.
- **`@session` — an actor reference, and a HANDLE.** Resolves to a **live board session** and carries *what
  you can do to it*: watch it, or send it a prompt. **`@new`** is the special actor — dispatch a **fresh
  worker** (on the surface's node / the thread's node), optionally with a preset. So an `@` in text is a
  contact you hand to a reader; what happens next is a **dispatch**, never a new datastore.
- **The two never collide** because topic is `[[]]` and actor is `@` — no weighting, no third symbol, and no
  reserved verbs. Every legacy `@<node>` usage was **migrated to `[[node]]`**: the composer autocomplete + the
  board fresh-session key ([[session-console]] / [[term-input]]) and the server's node-derivation (`MENTION`).
  The old `@new`/`@delete` **server directives were deleted, not migrated** — creating or deleting a node is
  now prompt-driven agent work (the board chords prefill a plain instruction; the server never mutates the
  spec tree, see [[dispatch]]). So `@` names an actor, `[[]]` names a topic, and nothing else wears a sigil.
- **Uniform in any input box, CLI-first.** The parse + resolve + dispatch live in spec-cli (a `mentions`
  module), so a forum reply, the composer, and an agent's own CLI prompt all run the SAME resolver; the
  dashboard is a thin autocomplete over it — and that autocomplete is itself ONE shared module
  (`spec-dashboard/src/mentions.jsx`: the `[[`/`@` trigger scanners, the ranking, the dropdown), consumed
  by every dashboard input that takes the grammar (the console's New prompt and ❯ inbox, the forum's
  composers), never re-implemented per surface. An agent `@`-ing another agent under a forum post is the
  identical path a human uses — **storage (the text) and delivery (the dispatch) stay separate**.
- **No new delivery pipe.** `@session` → [[dispatch]]'s `sendKeys` (a prompt = the surrounding text + a
  pointer to where it was written); `@new` → [[launch]]'s `newSession` (a fresh worker). Offline/unreachable
  fails loud (the `DispatchResult`), and the text still persists for the drain.
- **A reply has two delivery paths; only the explicit `@` is ASSIGNMENT.** Beside it, a committed reply
  gets an **implicit originator loop-in** — a *courtesy* copy to whoever ORIGINATED the thread, over the SAME
  resolution + `sendKeys`, delivered ONLY if they are online. Courtesy ≠ assignment: silent when offline
  (never a spawn or drain — only `@new` spawns), skipped when the originator is the replier or was already an
  explicit `@`-target. It carries the reply verbatim and is reported distinct from the `@`-dispatch. Who the
  originator is belongs to the *thread*: a forum author, or an eval-comment thread's reading-filer
  ([[yatsu-core]]) — a forge author is a github login resolving to nobody, silent by construction.
- **The drain guard: `@new` on a settled thread must not respawn its work.** Dispatch carries the thread's
  lifecycle status from the calling surface (the local forum always knows it; a forge reply's state is
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
