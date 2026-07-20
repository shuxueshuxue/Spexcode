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

Spec-driven development with AI agents in the loop. SpexCode keeps a versioned tree of specs inside
your git repo, links every spec to the code it governs, and runs a session manager that dispatches
coding agents into isolated worktrees. You review and merge; the tool keeps intent and
implementation from drifting apart.

[![Watch: this repo's spec tree grow from its git history](docs/spec-tree-poster.jpg)](https://spexcode.net/assets/spec-tree-growth.mp4)

<sub>▶ This repo's own spec tree, replayed from its git history — 160 spec nodes growing over three weeks. Click for the [full video](https://spexcode.net/assets/spec-tree-growth.mp4).</sub>

English | [中文](./docs/README.zh-CN.md) · Docs: [spexcode.net](https://spexcode.net) · License: MIT

Quick links: [the model](#the-model) · [quick start](#quick-start) ·
[agents](#working-with-agents) · [eval](#measuring-behavior-eval) · [config](#configuration)

## The model

<div align="center"><img src="docs/sdd-tuxedo-pooh.png" alt="spec-driven development meme" width="260"></div>

A spec node is a directory under `.spec/` containing a `spec.md`: frontmatter (title, status, a
`code:` pointer to the file it governs, a `related:` list for files it references) plus a prose
body stating what that part of the system is supposed to do, right now. Nodes nest, so the tree
mirrors how you think about the project rather than the file layout. The body can split into two
labelled parts. The short **raw source** states the intent; changing it takes explicit
human approval (an agent can draft it, a human signs off). The **expanded spec** is the agent's
detailed reading of that intent; it iterates freely but must always match the raw source.

<img src="docs/readme-node.png" alt="spec node popup">

Two rules make this workable:

1. **Git is the database.** There is no separate store. A node's version count is the number of
   commits that changed its `spec.md`, its history view is `git log` on that file, and each version
   is attributed to an agent session through a `Session:` commit trailer. This is also why a spec
   body always describes present intent and gets rewritten in place: changelog headings inside the
   body are banned (the linter enforces it), because git already keeps the history.
2. **Spec and code land together.** A change is one commit that updates both the `spec.md` and the
   code it justifies. When code moves without its spec, the linter flags it,

   ```
   drift: spec-cli/src/graph.ts is 1 commit(s) ahead of spec 'graph-lean' (v12) — may be stale
   ```

   and keeps flagging until the spec catches up.

## The optimization loop

Specs, commits, and evals compose into one loop. The spec is the loss function: it states what you
want, and it's the half a human signs off on. Commits are the optimizer. **eval**, the measurement
subsystem, scores how far live behavior currently sits from the spec, and the
score's history lives in git like everything else.

<img src="docs/readme-loop.png" alt="the spec/code optimization loop">

It also settles where the human stands day to day: nobody reads a neural net by staring at its
weights, and between merge gates you don't have to stare at agent diffs either. Attention goes to
the spec and the evals; the diff gets read once, at merge time.

## Quick start

Requires Node ≥ 22 and git. This part is plain tooling — no AI involved yet.

```sh
npm i -g spexcode                              # installs the `spex` command
cd your-repo
spex init --harness claude,codex,opencode,pi   # seeds .spec/, installs hooks, materializes the agent contracts
```

That's the whole adoption. The example lists all the built-in harnesses — remove the ones you don't
use: `--harness` is required, has no default, and takes any one id or comma-separated subset.
`spex init` is additive: it works on any existing git repo and never
overwrites your files — it creates a root `.spec/project/spec.md` and a starter `spexcode.json`,
installs the git hooks, and writes the selected harness's managed contract, so any agent working in
the repo discovers the workflow on its own.

When you want the live board — the graph, sessions, evals — start the runtime:

```sh
spex serve       # this project's backend — prints its URL, registers itself for your user
spex dashboard   # once per user, any directory: the one dashboard — open the URL it prints
```

Run `spex serve` from each project you want online. Every backend registers itself, and the single
`spex dashboard` finds them all — backends already running and ones you start later, in any order.
`/projects` switches and manages projects; each project's board lives under `/p/:id/`. There is no
per-project dashboard process and no port pairing to remember: if a port is taken, give that
backend its own with `spex serve --port <n>`, and trust the URL each command prints.

Those are installed-user commands. Contributors working from this source checkout use `npm run api`
for the reloadable backend and `npm run web` for the Vite/HMR frontend; see
[Contributing](#contributing).

Then grow the tree:

1. Edit `.spec/project/spec.md` to describe the project.
2. Add child nodes for the parts you want governed, each with a `code:` entry pointing at an
   existing file (`related:` for the files it touches but doesn't own).
3. Run `spex spec lint`. Coverage warnings list the source files no spec claims yet; that list is your
   adoption TODO.

You are not expected to hand-author all of this. The intended workflow is to have an agent do most
of the spec writing; `spex guide spec` prints the exact file format it needs.
[Getting started](https://spexcode.net/getting-started/) on the docs site walks the setup end to
end.

<img src="docs/readme-graph.png" alt="dashboard screenshot">

*SpexCode's own repo on its own board; the sessions top-left are agents building the tool.*

## Working with agents

This part needs tmux and a logged-in [Claude Code](https://www.anthropic.com/claude-code) or Codex
on the machine.

```sh
spex session new "make the settings page remember the last tab" --node settings
```

launches a worker session in its own worktree on branch `node/settings-…`. The `--node` flag (or a
`[[settings]]` mention in the prompt, same effect) sets the branch name and board attribution; the
worker still finds and reads the governing spec itself before touching code. It makes the change,
rewrites the spec body to match, commits
both (a hook stamps the `Session:` trailer), then proposes a merge and stops. Workers never merge
themselves. The merge stays with the manager: when you fire it, the session's own agent runs the
actual `git merge`, so conflicts land on the one who knows the work. The same dispatch is a
button on the dashboard (the new-session box on the board); the command form is what agents
themselves use when they delegate.

You supervise from outside — on the board, or with the same commands your agent uses:

```sh
spex session watch              # stream session transitions: launched / review / done / needs-input ...
spex session review settings    # commits ahead of trunk, merge-base diff, merge-conflict/lint gates
spex session merge settings     # gated merge into the trunk
spex session close settings
```

Independent tasks run in parallel. Each worker is isolated in its own worktree, git serializes the
merges, and a pre-commit guard blocks direct commits on the trunk, so everything flows through
reviewable node branches.

The process is enforced by mechanism, not prompt engineering: the backend creates the branch and a
hook stamps the attribution; the materialized contract block carries the rest, so your dispatch
prompt stays task-only. More on this mode of working:
[working with agents](https://spexcode.net/working-with-agents/).

## Measuring behavior: eval

eval is the measuring half of
[the loop](#the-optimization-loop), built on the YATU discipline (**You As The User**): you measure
behavior from the product's real surface, the way a real end user would touch it, not through an
internal helper or shortcut that makes the
proof easy. A spec says what a part should do; an
`eval.md` beside it says how to check. Each scenario is a plain description plus an expected
result. eval itself runs nothing (no DSL, no runner). An agent runs the scenario however it can:
a test file, a real browser, or just clicking through by hand and screenshotting. It compares
actual to expected and files the eval with evidence:

```sh
spex eval add settings --scenario remembers-tab --pass --image evidence.png
```

Evals live in a git-tracked ndjson next to the spec, so measurements get the same attribution
and history as spec versions. Bug fixes are expected to bracket: file a failing eval that
reproduces the bug, fix, then file a passing eval on the same scenario.

<img src="docs/readme-eval.png" alt="eval view screenshot">

*The eval view: scenario evals on the left; the selected eval's expected result, staleness,
and recorded video evidence in the middle.*

## What's in the repo

| Package | Role |
|---|---|
| `spec-cli` | The `spex` CLI and the HTTP backend (Hono, runs via tsx, no build step). Reads `.spec` and git live; owns the session state machine and the linter. |
| `spec-dashboard` | React board: the node graph, per-node spec/history/issues panes, and a real terminal onto each live agent session. |
| `spec-eval` | Scenario definitions, evals, evidence. |
| `spec-forge` | Read-only tracer that resolves a forge's open issues and PRs to the spec nodes they serve (GitHub and GitLab drivers today). An issue links itself with a `Spec: <node-id>` line in its body; a PR from a `node/<id>` branch links for free. |

## The linter

`spex spec lint` checks the spec↔code graph and is the real gate (the git hook is fast local feedback):

- **integrity** (error): a `code:` or `related:` path that doesn't exist
- **living** (error): a changelog heading in a spec body
- **coverage** (warn): unclaimed source files
- **drift** (warn): governed code changed after its spec's last version, derived live from git

plus naming and ownership rules (`one-govern`, `id-format`, `mention` as errors; `breadth`,
`related-drift`, `owners`, `confusable-id` as warns) — `spex guide spec` lists them all.

`spex doctor` is the opt-in, read-only health diagnosis. Its altitude check reports bodies that look like
implementation dumps, with the evidence and repair, without putting heuristic judgment in the lint or commit gate.

## Configuration

`spexcode.json` (committed, portable: layout, lint policy, doctor health budgets, project dashboard identity, launcher names) and
`spexcode.local.json` (gitignored, host-specific: absolute launcher paths, cert paths) cover every
setting. There is no imperative settings verb: you edit the two files by hand (or ask your agent
to), and `spex guide settings` documents every field. The Projects admin UI writes a project's icon back
to that same `dashboard.icon` field; the global gateway icon is the one separate host fact at
`$SPEXCODE_HOME/config.json` `gateway.icon`, never copied into a repo. The other
manuals are `spex guide` (the workflow), `spex guide spec`, `spex guide eval`, and
`spex guide footprint`; `spex help` maps the commands.

## Contributing

[`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) gets you from a clone to a first merged change.
[`docs/AGENT_GUIDE.md`](docs/AGENT_GUIDE.md) has the full mechanics of the node model and the
reflexive plugin system.

## Credit

First introduced on the [LINUX DO](https://linux.do) community — thanks to everyone there for the first round of discussion.

## License

[MIT](./LICENSE).
