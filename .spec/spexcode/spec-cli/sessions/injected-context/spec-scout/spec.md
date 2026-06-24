---
title: spec-scout
status: pending
hue: 280
desc: An active spec-consult sub-agent injected into a launched session — ask it a behaviour/topic question and it surfaces the governing spec node(s) and the user-story they encode, so reaching the spec is as cheap as grepping the code.
---

# spec-scout

## raw source

The three existing injections ([[spec-pointer]], [[spec-first]], [[spec-of-file]]) are all **passive**: they
point at a path, nudge once, or annotate an edit. Each assumes the agent already knows **which** node is its
ground truth. For a *behaviour question* not bound to one node — "what happens on `/exit`?" — that assumption
breaks: the agent doesn't know which spec is relevant, and there is **no spec search**, so it falls back to
**code search** (`Grep` / the Explore agent), which is first-class and cheap.

That fallback has a hidden bias. Code search ranks by **architectural centrality**; the spec ranks by
**user-story importance**, and the two rankings diverge. The `/exit` interception is a trivial client-side
special-case in code but a load-bearing behaviour in the [[session-console]] spec — so a code-first answer
confidently under-discovers exactly the user-facing behaviour the spec foregrounds. (Observed live: this
session answered `/exit` from code and got it wrong; only reading the node corrected it.)

The fix direction is an **active** counterpart: a spec-aware **sub-agent the spawning system injects into the
session** — the spec analog of Explore — that takes a topic or behaviour question and returns the governing
node(s) plus the user-story/friction they encode. The aim is to make consulting the spec the **path of least
resistance**, not a nudge the agent scrolls past, so spec-first becomes a reflex for *analysis / Q&A*
sessions, not only for *implement* sessions.

## expanded spec

PENDING — problem captured here; mechanism deferred to a dedicated design pass. The open questions that pass
must settle:

- **Surface** — a registered sub-agent type reached via the Agent tool (like Explore), versus a `spex` verb
  (`spex spec <topic>`) the harness teaches the agent about. The "extra sub-agent injected by the spawning
  system" framing favours the former.
- **Retrieval** — how it ranks nodes by *user-story* relevance rather than keyword/path overlap, so it
  returns what the spec deems important, not what the code happens to centre on.
- **Boundary** — it *reads and surfaces* spec intent; it does not review code and does not replace
  [[spec-first]]'s grounding gate. The Stop gate stays the enforcer.

Lives in [[injected-context]] as its fourth, **active** injection, beside the three passive ones.
