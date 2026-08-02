<div align="center">

<img src="docs/banner.png" alt="SpexCode" width="720">

<p>
  <a href="https://www.npmjs.com/package/spexcode"><img alt="npm" src="https://img.shields.io/npm/v/spexcode?logo=npm&logoColor=white&color=cb3837"></a>
  <img alt="license: MIT" src="https://img.shields.io/badge/license-MIT-2f81f7">
  <img alt="node &ge; 22" src="https://img.shields.io/badge/node-%E2%89%A5%2022-3fb950?logo=nodedotjs&logoColor=white">
  <a href="https://spexcode.net"><img alt="docs" src="https://img.shields.io/badge/docs-spexcode.net-8957e5"></a>
</p>

<p>
  <img alt="Linux" src="https://img.shields.io/badge/Linux-supported-success?logo=linux&logoColor=white">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-supported-success?logo=apple&logoColor=white">
  <img alt="Windows: via WSL2" src="https://img.shields.io/badge/Windows-WSL2-success">
  <img alt="database: git" src="https://img.shields.io/badge/database-git-f05032?logo=git&logoColor=white">
</p>

</div>

Spec-driven orchestration for your coding agents. SpexCode keeps a versioned tree of specs inside
your git repo, links every spec to the code it governs, and runs a session manager that dispatches
coding agents into isolated worktrees. You review and merge; the tool keeps intent and
implementation from drifting apart.

English | [中文](./docs/README.zh-CN.md) · Docs: [spexcode.net](https://spexcode.net) · License: MIT

| | |
|---|---|
| **Drift you can compute** | Every spec pins the file — down to the function — it governs. A mechanical git check flags code that moved without its spec: advisory for the file, blocking when an anchored function changes. No embeddings, no guesswork; just commits and line ranges. |
| **An agent army, one human gate** | Each task dispatches into its own worktree and branch under one supervision state machine: `working → review → merged`. Workers propose; you review once, at merge time. Independent tasks run in parallel. |
| **Everything is a URL** | Spec nodes, sessions, evals, live terminals — every dashboard view has a stable address you can send to a colleague. Two people can watch the same session board. |
| **Building bricks, not a monolith** | Three separable layers: the spec↔code data asset (L0), the session substrate (L1), the dashboard (L2). Take what you need — the lower layers are designed as bricks for your own software factory. |
| **Your harness, not ours** | Claude Code, Codex, OpenCode, pi — interactive or headless. One materialized workflow contract serves them all; adding a harness is config, not a rewrite. |

## The model

A spec node is a directory under `.spec/` holding a `spec.md`: frontmatter naming the one file it
governs (`code:` — optionally pinned to specific functions with `path#symbol`) and the files it
references (`related:`), then a prose body stating what that part of the system is supposed to do,
right now. Nodes nest, so the tree mirrors how you think about the project rather than the file
layout. The body can split into two labelled parts: a short **raw source** a human signs off on, and
an **expanded spec** the agent iterates freely — as long as it keeps matching the raw source.

<img src="docs/readme-model.svg" alt="a spec node governs one file, anchored at function level; related files are referenced; git is the only database">

There is no second store to sync or corrupt: a node's versions are the commits that touched its
`spec.md`, and each version is attributed to an agent session through a `Session:` commit trailer.
A change is one commit that updates both the spec and the code it justifies. When code moves alone,
the linter notices:

<img src="docs/readme-drift-flow.svg" alt="drift timeline: a code-only commit that misses the anchored function is an advisory warn; one that edits it is a blocking anchor-drift error, resolved by updating the spec or acking with a reason">

The check compares plain git facts — which commits came after the spec's last version, and whether
they intersect the anchored unit's lines. It cannot tell you whether the new behavior is better; it
can only tell you the spec no longer describes it. That is exactly what makes it worth running: the
rename that misses one spec out of eight is not careless, it is normal.

## Why prose

An agent reasons in text: its chain of thought is a sequence of natural-language tokens. So before it
can change your code it restates that code as intent — and the restatement adds information the code
did not contain. That added part is a guess, drawn from how code shaped like this usually behaves. It
is accurate exactly where your code is conventional and wrong exactly where it isn't, which is where
the decisions worth keeping live. A wrong guess doesn't announce itself; it produces confident code
built on a misread. Every programming language ever designed grew a syntax for comments, because the
formal part has never been able to carry why.

So you don't get to choose whether a spec exists. Every read of your codebase reconstructs one; you
only choose whether it was written down once and reviewed, or re-guessed on each read by someone who
wasn't there. That also settles what belongs in a body: the constraint, the rejected alternative, the
policy, the invariant that looks removable and isn't — the part no reader could recover from the code.
A body that narrates what the code plainly does is worth nothing, because the reader can already
generate it.

## Software as a learning loop

Specs, commits, and evals compose into one optimization loop. The spec is the loss function: it
states what you want, and it is the half a human signs off on. Commits are the optimizer. **eval**,
the measurement subsystem, scores how far live behavior currently sits from the spec — an agent runs
each scenario against the product's real surface, the way an end user would touch it, and files the
result with evidence (a screenshot, a recording). The score's history lives in git like everything
else, and a bug fix is expected to bracket: a failing eval that reproduces the bug, then a passing
one on the same scenario.

<div align="center"><img src="docs/readme-loop.png" alt="the spec/code optimization loop" width="560"></div>

Nobody reads a neural net by staring at its weights, and between merge gates you don't stare at
agent diffs either. Attention goes to the two ends — the spec and the evals; the diff gets read
once, at merge time.

## Quick start

Requires Node ≥ 22 and git. This part is plain tooling — no AI involved yet.

```sh
npm i -g spexcode                              # installs the `spex` command
cd your-repo
spex init --harness claude,codex,opencode,pi,claude-headless,opencode-headless,pi-headless,codex-headless   # seeds .spec/, installs hooks, materializes the agent contracts
```

That's the whole adoption. The example lists all the built-in harnesses — remove the ones you don't
use: `--harness` is required, has no default, and takes any one id or comma-separated subset.
`spex init` is additive: it works on any existing git repo, never overwrites your files, and does
three things — seeds a root `.spec/project/spec.md` plus a starter `spexcode.json`, installs the git
hooks, and **materializes** the workflow rules into the files your agent already reads (`CLAUDE.md`,
`AGENTS.md`): read the governing spec before the code, land spec and code in one commit, propose
merges instead of performing them. Any agent that opens the repo discovers the workflow on its own —
no special dispatch prompt, no per-agent setup. `spex materialize` re-runs that last step whenever
the contracts need refreshing.

When you want the live board — the graph, sessions, evals — start the runtime:

```sh
spex serve       # this project's backend — prints its URL, registers itself for your user
spex dashboard   # once per user, any directory: the one dashboard — open the URL it prints
```

Run `spex serve` from each project you want online; the single `spex dashboard` finds them all, in
any start order. If a port is taken, `spex serve --port <n>` and trust the URL it prints. Then grow
the tree: describe the project in `.spec/project/spec.md`, add child nodes for the parts you want
governed, and let `spex spec lint`'s coverage warnings be your adoption TODO. You are not expected
to hand-author this — an agent does most of the spec writing, and `spex guide spec` prints the exact
format it needs. [Getting started](https://spexcode.net/getting-started/) walks the setup end to end.

## How it's put together

Three stacked layers, and each is worth having without the ones above it:

<img src="docs/readme-layers.svg" alt="L0 the spec-code data asset, L1 the agent session substrate, L2 the dashboard workspace — an adoption ladder">

L0 is the asset an organisation adopts and never throws away — plain files in plain git, useful
offline, with no daemon in the loop. ([Watch this repo's own L0 grow from its git
history](https://spexcode.net/assets/spec-tree-growth.mp4) — 160 spec nodes over three weeks.)
L1 turns that asset into labor: the session state machine below. L2 is the workspace you watch it
all from — and because it is only a consumer of L1, anything the dashboard does, your scripts and
agents can do through the same CLI.

## Working with agents (L1)

This part needs tmux and a logged-in [Claude Code](https://www.anthropic.com/claude-code) or Codex
on the machine (on Windows, run inside WSL2).

```sh
spex session new "[[uploader]] retry failed chunks with backoff"
```

launches a worker session in its own worktree on branch `node/uploader-…`. The prompt's first
`[[uploader]]` mention sets the branch name and board attribution; the worker still finds and reads
the governing spec itself before touching code. It makes the change, rewrites the spec body to
match, commits both (a hook stamps the `Session:` trailer), then proposes a merge and stops:

<img src="docs/readme-worker-flow.svg" alt="the eight-step worker loop: dispatch, read the spec, do the work, run evals, clear drift, propose a merge, human review, close">

Workers never merge themselves. The merge stays with you — and when you fire it, the session's own
agent runs the actual `git merge`, so conflicts land on the one who knows the work. The same
dispatch is a button on the dashboard; the command form is what agents themselves use when they
delegate. You supervise from either side:

```sh
spex session ls                  # the living table below
spex session watch stream        # follow transitions: working → review → done …
spex session review uploader     # commits ahead of trunk, merge-base diff, merge/lint gates
spex session merge uploader      # hands the gated merge to the session's own agent
spex session close uploader      # retire the worktree, branch, and record
```

<img src="docs/readme-sessions.svg" alt="animated terminal: spex session ls listing five sessions across working, review, asking and done states">

The process is enforced by mechanism, not prompt engineering: the backend creates the branch, a git
hook stamps the attribution, a pre-commit guard blocks direct commits on the trunk, and the
materialized workflow rules in `CLAUDE.md`/`AGENTS.md` carry the rest — so your dispatch prompt
stays task-only. More on this mode of working:
[working with agents](https://spexcode.net/working-with-agents/).

## The dashboard (L2)

Everything above has a live face. `spex serve` + `spex dashboard`, then:

<img src="docs/readme-graph.png" alt="the spec map: SpexCode's own repo on its own board, with agent sessions attached to the nodes they work">

*Your whole repo as one map — SpexCode's own board shown. Agents appear on the nodes they are
working; the panel top-left is the live session console.*

<img src="docs/readme-node.png" alt="a node opened on the board: raw source and expanded spec, version history, governed file">

*Click a node: its raw source and expanded spec, the version history git already kept, the file it
governs, its issues.*

<img src="docs/readme-eval.png" alt="the eval view: scenarios on the left, the selected reading's expected result and recorded video evidence">

*Each session's evals reviewed in one place — expected result, staleness, and the recorded evidence
(video, screenshots) an agent filed for it.*

And because the whole workspace is served over HTTP, every view — a spec node, a session, an eval
reading, a live terminal — is a stable URL you can hand to a colleague; you can sit on the same
board together. The terminal pane is a real tmux session: copy the printed command and attach from
your own terminal whenever the browser is the wrong tool.

## Contributing

[`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) gets you from a clone to a first merged change.
[spexcode.net](https://spexcode.net) has the full mechanics of the node model and the
reflexive plugin system.

## Credit

First introduced on the [LINUX DO](https://linux.do) community — thanks to everyone there for the first round of discussion.

## License

[MIT](./LICENSE).
