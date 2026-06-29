---
title: spec-scout
status: active
hue: 280
desc: An on-demand spec-consult sub-agent (the spec analog of Explore) — ask it a behaviour/topic question and it surfaces the governing spec node(s), the user-story they encode, and the code to read, so reaching the spec is as cheap as grepping the code.
code:
  - .spec/spexcode/.config/spec-scout/spec.md
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

The floor is BUILT and so is the agent that wields it. Evidence from real worker transcripts grounds the
shape: agents ALREADY hand-roll spec search (`grep .spec` + `spex board`), so none of this is new behaviour
— it upgrades that reflex into a ranked retriever plus an agent that reads the winning bodies.

- **The floor is a TOOL; spec-scout is the AGENT.** `spex search` ([[spec-search]]) is a pure lexical
  retrieval primitive — LLM-free, deterministic, fast, no auth, like `grep`. spec-scout is **the spec analog
  of Explore**: an Agent-tool sub-agent that *uses* the floor. So the user-story rerank **IS that sub-agent,
  not a CLI flag.** It calls `spex search --json`, then **reads the candidate bodies in full** and reranks
  them by *user-story* relevance in its own context. The CLI never calls an LLM; the agent does. (Shelling
  the CLI out to an LLM was rejected: it crosses "the CLI is a deterministic primitive" for latency + an auth
  dependency, and mismatches the Explore-analog identity. ~80 nodes + an altitude budget let the sub-agent
  read the whole tree — no embeddings yet.)
- **Retrieval** — the floor already shares ONE ranker with the human `/` panel ([[keyboard-nav]]'s layered
  title/id/desc/body weighting): what you give the human, give the agent. spec-scout layers *user-story*
  reranking on that lexical floor; it does not build a second retriever.
- **Boundary — locate, don't merge.** Do NOT fold spec and code into one index: code search ranks by
  architectural centrality, spec by user-story — that divergence is the whole point. spec-scout locates the
  governing node *by reading its body*, then scopes the existing code search (Explore / grep) to that node's
  own `code:` files — taken straight from the frontmatter of the body it just read, never a separate index
  and never harvested without the prose that scopes them. Reading the whole body is the job, not a step to
  skip: specs run ~1/20th the size of the code they govern, so reading more of them is cheap. It surfaces
  spec intent; it does not review code, nor replace [[spec-first]]'s grounding gate (the Stop gate stays the
  enforcer).

Built as a `surface: agent` config node (the `.config` sibling: agent prompt + `desc:` trigger + read-only
`tools:`) that [[harness-delivery]]'s materialize renders into each harness's agent dir (Claude
`.claude/agents/`; a harness lacking the primitive gets none — the [[harness-adapter]] `agentDir`, the
`skillDir` analog) as a generated, gitignored artifact, not a committed file. **On-demand** (spawned when a
session needs it), NOT folded into every prompt: it makes the floor + body-reading a first-class "find my
contract" reflex *without* a sixth `surface:system` injection (sidestepping that prompt-dilution). Its
read-only tools (Bash/Read/Grep/Glob — no edit) enforce the "surfaces, never reviews or edits code" boundary. It is the fourth, **active** member of [[injected-context]]'s grounding set — the only
on-demand one beside the three passive prompt injections.
