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

PENDING — problem captured; mechanism deferred to a design pass. Evidence from real worker transcripts
sharpens the direction: agents ALREADY hand-roll spec search (`grep .spec` + `spex board`), so this is not
new behaviour — it upgrades an existing reflex into a retriever that can rank and search prose body. The
design questions, with their evidence-backed lean:

- **Surface — locked.** The contract is settled: a `spex search <query> [--json] [--limit N]` verb returning
  a score-ranked list of nodes, each with a body-match snippet — **defined and owned by the lexical-floor
  node** ([[spec-search]], its own branch off main), not redefined here. spec-scout is that floor's **`--deep`
  consumer**: bare query = the lexical ranking; `--deep` routes here to rerank by *user-story* / LLM. It
  depends only on the contract, never the floor's implementation, so the two branches stay independent. The
  agent reflex is already `grep .spec`, so the verb takes over with zero retraining; ~80 nodes + an altitude
  budget let the sub-agent read the whole tree — no embeddings yet.
- **Retrieval** — share ONE ranker with the human `/` panel ([[keyboard-nav]]'s layered title/id/desc/body
  weighting): what you give the human, give the agent. spec-scout layers *user-story* / LLM ranking on that
  lexical floor; don't build a second retriever.
- **Boundary — relay, not merge.** Do NOT fold spec and code into one unified index. Code search is already
  first-class (agents grep code fluently) and ranks by architectural centrality; spec ranks by user-story —
  the very divergence that makes spec search worth having. spec-scout *locates the governing node*, then
  hands off to the existing code search (Explore / grep) scoped to that node's `code:` files, each ranked by
  its own logic. It surfaces spec intent; it does not review code, nor replace [[spec-first]]'s grounding
  gate (the Stop gate stays the enforcer). A "semantic search" umbrella name is fine — the build stays
  spec-first.

Lives in [[injected-context]] as its fourth, **active** injection, beside the three passive ones.
