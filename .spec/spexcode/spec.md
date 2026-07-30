---
title: spexcode
status: active
session: sess-meta
hue: 45
desc: A spec-driven, self-developing dev tool — the spec tree is ground truth, git is its database.
---
# spexcode

The project root. This node is the hour-0 founding spec (it literally grew from
`.spec/dashboard/interface.md`, folded in here verbatim below), so the whole tree now hangs from the
intent that started it.

Everything else is a child package: **spec-dashboard** (the node-graph UI), **spec-cli** (the server,
the git-as-database reader, and the source-of-truth guards), **spec-forge** (a read-only tracer that
resolves a forge's open issues/PRs to the spec nodes they serve), and **spec-eval** (the
loss-measurement system — each node's scenarios scored against their expected outcome, the signal the
optimizer reads).

Those packages implement **three stacked layers**, and keeping them distinct is what keeps the project
from rotting into one blur. **L0 — the data asset**: the spec↔code graph, its git-derived history, and
`spex lint`; the thing an organisation adopts and never throws away, so it is judged by generality,
robustness, and an **install surface small enough that nothing can stop it landing** (an install-time
dependency that can fail on a user's machine is a barrier to the asset ever starting to accumulate, and
is refused at this altitude). **L1 — the agent-army substrate**: the session state machine that drives
workers on top of that asset, the brick a CI, a review pipeline, or a software factory builds with, so it
is judged by **scale and composability** — a mechanism whose cost grows with (observers × subjects) is a
defect here even while it is fast enough today, because the growth term is what caps the army. **L2 — the
reference workspace**: the HTTP/SSE/WS faces, the dashboard, the gateway; a **consumer** of L1 and never
its gatekeeper, judged by interaction density, and the reason this project can dogfood itself at all.

The stack is also the adoption ladder — take L0 alone and get the whole data asset, add L1 for an agent
army, add L2 for the workspace — so **each layer must be worth having without the ones above it**.

`config/` holds **reflexive, skill-shaped preset nodes** — each a spec node whose folder bundles a prompt
template (`spec.md`, with a `{{targets}}` placeholder) plus any helper scripts/assets, served by
`GET /api/plugins` for the new-session `/` dropdown to compose over @-referenced target nodes.

## origin (hour 0)
The original prompt that defined the system, kept verbatim:

```
一个 node-graph 形态的界面，每个节点是一个 spec，spec 呈现树状关系。spec 有版本变迁历史，每次版本变迁都 attribute 到一个 claude code session。用户的所有指令落实到一个具体的 spec 节点上，也可以由一个层级较高的 spec 节点来进行子节点自动分配和创建，节点上只能有一个正在工作的 claude code session，每个 claude code session 都在自己的 worktree 里面，都是基于最新的 main 分支创建的。
```
