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
  <img alt="Windows" src="https://img.shields.io/badge/Windows-untested-lightgrey">
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
`code:` list of the files it governs) plus a prose body stating what that part of the system is
supposed to do, right now. Nodes nest, so the tree mirrors how you think about the project rather
than the file layout. The body has two parts. The short **raw source** states the intent; changing it takes explicit
human approval (an agent can draft it, a human signs off). The **expanded spec** is the agent's
detailed reading of that intent; it iterates freely but must always match the raw source.

<img src="docs/readme-node.png" alt="spec node popup">

Two rules make this workable:

1. **Git is the database.** There is no separate store. A node's version count is the number of
   commits that touched its `spec.md`, its history view is `git log` on that file, and each version
   is attributed to an agent session through a `Session:` commit trailer. This is also why a spec
   body always describes present intent and gets rewritten in place: changelog headings inside the
   body are banned (the linter enforces it), because git already keeps the history.
2. **Spec and code land together.** A change is one commit that updates both the `spec.md` and the
   code it justifies. When code moves without its spec, the linter flags it,

   ```
   drift: spec-cli/src/board.ts is 1 commit(s) ahead of spec 'board-lean' (v8) — may be stale
   ```

   and keeps flagging until the spec catches up.

## The optimization loop

Specs, commits, and eval readings compose into one loop. The spec is the loss function: it states what you want, and
it's the half a human signs off on. Commits are the optimizer. **eval**, the measurement
subsystem, is the eval: it scores how far live behavior currently sits from the spec, and the
score's history lives in git like everything else.

<img src="docs/readme-loop.png" alt="the spec/code optimization loop">

It also settles where the human stands day to day: nobody reads a neural net by staring at its
weights, and between merge gates you don't have to stare at agent diffs either. Attention goes to
the spec and the eval readings; the diff gets read once, at merge time.

## Quick start

Requires Node ≥ 22 and git. This part is plain tooling — no AI involved yet.

```sh
npm i -g spexcode        # installs the `spex` command
cd your-repo
spex init                # seeds .spec/, installs git hooks, materializes the agent contract
spex serve               # API backend on :8787
spex dashboard           # board UI on :5173, proxying to the backend
```

`spex init` is additive. It works on any existing git repo and never overwrites your files: it
creates a root `.spec/project/spec.md` and a starter `spexcode.json`, installs the pre-commit
hooks, and writes a managed block into `CLAUDE.md`/`AGENTS.md` so any agent working in the repo
discovers the workflow on its own.

Then grow the tree:

1. Edit `.spec/project/spec.md` to describe the project.
2. Add child nodes for the parts you want governed, each with a `code:` list pointing at existing
   files.
3. Run `spex lint`. Coverage warnings list the source files no spec claims yet; that list is your
   adoption TODO.

You are not expected to hand-author all of this. The intended workflow is to have an agent do most
of the spec writing; `spex guide spec` prints the exact file format it needs.
[Getting started](https://spexcode.net/getting-started/) on the docs site walks the setup end to
end.

<img src="docs/readme-board.png" alt="dashboard screenshot">

*SpexCode's own repo on its own board; the sessions top-left are agents building the tool.*

## Working with agents

This part needs tmux and a logged-in [Claude Code](https://www.anthropic.com/claude-code) or Codex
on the machine.

```sh
spex new "make the settings page remember the last tab" --node settings
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
spex watch              # stream session transitions: launched / review / done / needs-input ...
spex review settings    # commits ahead of trunk, merge-base diff, typecheck/lint gates
spex merge settings     # gated merge into the trunk
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
behavior from the product's real surface, the way a
clueless real end user would touch it, not through an internal helper or shortcut that makes the
proof easy. A spec says what a part should do; an
`eval.md` beside it says how to check. Each scenario is a plain description plus an expected
result. eval itself runs nothing (no DSL, no runner). An agent runs the scenario however it can:
a test file, a real browser, or just clicking through by hand and screenshotting. It compares
actual to expected and files the reading with evidence:

```sh
spex eval add settings --scenario remembers-tab --pass --image proof.png
```

Readings live in a git-tracked ndjson next to the spec, so measurements get the same attribution
and history as spec versions. Bug fixes are expected to bracket: file a failing reading that
reproduces the bug, fix, then file a passing reading on the same scenario.

<img src="docs/readme-eval.png" alt="eval view screenshot">

*The eval view: scenario readings on the left; the selected reading's expected result, staleness,
and recorded video evidence in the middle.*

## What's in the repo

| Package | Role |
|---|---|
| `spec-cli` | The `spex` CLI and the HTTP backend (Hono, runs via tsx, no build step). Reads `.spec` and git live; owns the session state machine and the linter. |
| `spec-dashboard` | React board: the node graph, per-node spec/history/issues panes, and a real terminal onto each live agent session. |
| `spec-eval` | Scenario definitions, readings, evidence blobs. |
| `spec-forge` | Read-only tracer that resolves a forge's open issues and PRs to the spec nodes they serve (GitHub today). An issue links itself with a `Spec: <node-id>` line in its body; a PR from a `node/<id>` branch links for free. |

## The linter

`spex lint` checks the spec↔code graph and is the real gate (the git hook is fast local feedback):

- **integrity** (error): a `code:` path that doesn't exist
- **living** (error): a changelog heading in a spec body
- **altitude** (warn): a body that slid from contract prose into an implementation dump. The usual
  smell is a numbered step list or a wall of function names; this rule is why spec bodies stay
  short enough to actually read
- **coverage** (warn): unclaimed source files
- **drift** (warn): governed code changed after its spec's last version, derived live from git

## Configuration

`spexcode.json` (committed, portable: layout, lint budgets, dashboard identity, launcher names) and
`spexcode.local.json` (gitignored, host-specific: absolute launcher paths, plus a `private: true`
overlay for repos you use but don't own) cover every setting. No `spex config set` yet: you edit the two files by hand (or ask your agent
to), and `spex guide config` documents every field. The other
manuals are `spex guide` (the workflow), `spex guide spec`, and `spex guide eval`; `spex help`
maps the commands.

## Contributing

[`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) gets you from a clone to a first merged change.
[`docs/AGENT_GUIDE.md`](docs/AGENT_GUIDE.md) has the full mechanics of the node model and the
reflexive config system.

## Credit

First introduced on the [LINUX DO](https://linux.do) community — thanks to everyone there for the first round of discussion.

## License

[MIT](./LICENSE).
