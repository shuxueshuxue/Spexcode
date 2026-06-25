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

The floor and the relay are BUILT; the remaining piece is `--deep`, and its mechanism is now decided.
Evidence from real worker transcripts grounds the shape: agents ALREADY hand-roll spec search (`grep .spec`
+ `spex board`), so none of this is new behaviour — it upgrades that reflex into a ranked, body-aware
retriever plus an agent that wields it.

- **The floor is a TOOL; spec-scout is the AGENT.** `spex search` ([[spec-search]]) is a pure lexical
  retrieval primitive — LLM-free, deterministic, fast, no auth, like `grep`. spec-scout is **the spec analog
  of Explore**: an Agent-tool sub-agent that *uses* the floor. So **`--deep` IS that sub-agent, not a CLI
  flag.** It calls `spex search --json`, reranks the candidates by *user-story* relevance in its own context,
  then hands the winners to the relay. The CLI never calls an LLM; the agent does. (Shelling the CLI out to
  an LLM was rejected: it crosses "the CLI is a deterministic primitive" for latency + an auth dependency,
  and mismatches the Explore-analog identity. ~80 nodes + an altitude budget let the sub-agent read the whole
  tree — no embeddings yet.)
- **Retrieval** — the floor already shares ONE ranker with the human `/` panel ([[keyboard-nav]]'s layered
  title/id/desc/body weighting): what you give the human, give the agent. spec-scout layers *user-story*
  reranking on that lexical floor; it does not build a second retriever.
- **Boundary — relay, not merge.** Built as [[relay]] (`spex relay <q>` → the top hits' governed `code:`,
  with a codeless-parent fall-through to subtree code). Do NOT fold spec and code into one index: code search
  already ranks by architectural centrality, spec by user-story — that divergence is the whole point.
  spec-scout *locates the governing node*; the relay scopes the existing code search (Explore / grep) to that
  node's files. It surfaces spec intent; it does not review code, nor replace [[spec-first]]'s grounding gate
  (the Stop gate stays the enforcer).

Lives in [[injected-context]] as its fourth, **active** injection — the agent that turns the floor + relay
into a first-class "find my contract" reflex. The sub-agent definition itself is the remaining build.
