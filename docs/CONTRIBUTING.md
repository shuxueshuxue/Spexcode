# Contributing to SpexCode

Thanks for wanting to work on SpexCode. This file is the **human** entry point. The full mechanics —
the spec-node model, the lint rules, the reflexive plugin system — live at [spexcode.net](https://spexcode.net)
and in `spex guide`; this page gets you from a clone to your first merged change without reading all of
that first.

## The one idea you must hold

SpexCode **dogfoods itself**: a change to the tool isn't "done" until it's a *spec node* merged into
`main`. A spec node is a directory under `.spec/` whose `spec.md` body states a part's **present** intent
(it's rewritten in place — never a `## vN` changelog; version history is git's job). Every code change lands
**together with** the `spec.md` that justifies it. So the unit of contribution is not "a diff" — it's
"intent + implementation, in one commit."

If you only ever touch code and never the spec it belongs to, you're working against the grain. Find
the governing node first (`spex spec search <topic>`), read its body — that's the contract — then make the
code honor it, or edit the spec first if you're changing the intent.

## Set up a checkout

Requires **Node ≥ 22** (`.nvmrc` pins it) and **git**. npm, not pnpm.

```sh
git clone https://github.com/shuxueshuxue/spexcode && cd spexcode
npm --prefix spec-cli install
npm --prefix spec-dashboard install
npm run hooks          # install the per-clone git hooks (main-guard + lint shim, session-stamp, footprint refresh)
```

`npm run hooks` is **not optional and not one-time-global** — git never clones `.git/hooks/`, so every
fresh clone needs it (one run covers all of that clone's worktrees: the hooks install into the shared
git common dir). Re-run it whenever the hook source under
`spec-cli/templates/hooks/` changes. The hook is advisory local feedback; the real gate is CI running
`spex spec lint`.

The dev loop runs from the source checkout (an installed user runs `spex serve` / `spex serve ui`
instead):

```sh
npm run api            # backend on :8787, hot-reloads on spec-cli/src changes
npm run web            # the dashboard via Vite (HMR), proxying /api → :8787
```

> Note: the live, multi-agent *session* features (dispatching workers, the dashboard's live terminals) shell
> out to a coding-agent harness — **Claude Code or Codex** — and **tmux**; see the prerequisites in
> [`README.md`](../README.md). You
> do **not** need either to work on the governance layer (`spex spec lint`, the spec tree, the dashboard, the
> git-as-database reader).

## The contribution ritual, for a human

1. Branch `node/<id>` off `main` (`<id>` = a short kebab-case name for the change).
2. Make the code change **and** add/update the `spec.md` that states its intent — in the same change.
3. `spex spec lint` must be **0 errors** (warnings are guidance). Type-check with `npx tsc --noEmit` in
   `spec-cli` if you touched the backend.
4. Commit on the node branch: `spec: <id> — <reason>`.
5. Open a PR from your `node/<id>` branch (or, inside the tool's own session flow,
   `spex session done --propose merge`). **A maintainer performs the `--no-ff` merge** — the proposer
   never merges their own change. That human-in-the-loop merge is deliberate.

`main` is guarded: a pre-commit hook blocks direct commits to it. Branch, always.

## What "good" looks like

- **Smallest change that fully satisfies the intent.** Writing code spends complexity to buy behavior;
  don't spend it casually.
- **The spec body stays a living current-state document** — present tense, rewritten in place. If you
  find yourself appending a "## v2" section, stop: that's what git history and the dashboard's
  history tab are for.
- **One independently-scoped feature → its own node.** Cosmetic polish riding along inside an unrelated
  node's commit is the smell.
- **Fail loudly.** Don't hide errors behind silent fallbacks.

The project's engineering taste lives in the `taste` plugin node
(`.spec/spexcode/.plugins/skills/taste/spec.md`) — worth reading
once you've landed a first change.

## Reporting bugs & proposing features

- **Bugs / features:** open a GitHub issue. If it maps to a spec node, add a `Spec: <node-id>` line to
  the issue body (the id is the node's leaf folder name) so it links to the intent it serves.
- **Security vulnerabilities:** do **not** open a public issue — see [`SECURITY.md`](./SECURITY.md).

## License

SpexCode is MIT-licensed ([`LICENSE`](../LICENSE)). By contributing, you agree your contributions are
licensed under the same terms.

## Architecture / data flow

- `spec-cli/` — Hono backend, run with `tsx` (**no build step**; `npx tsc --noEmit` to type-check).
  Reads `.spec` + git live. The dashboard's single source is **`GET /api/graph`** (assembled
  tree + overlay + sessions); other surfaces include `GET /api/specs`, `GET /api/specs/:id/history`
  (+ `/diff/:hash`), `GET /api/settings` (the resolved layout + launcher profiles), `GET /api/plugins`
  (the gathered command-surface plugins),
  `GET /api/slash-commands`, and the whole **`/api/sessions` state-machine** (list/create/review/
  merge/resume/capture/input/stop/close/rename + the **`:id/socket` terminal WebSocket** and `edges`).
  Loader: `src/specs.ts`; git access: `src/git.ts`; sessions/launch: `src/sessions.ts`;
  portability seam: `src/layout.ts` (`resolveLayout()`, optional `spexcode.json` override for
  non-default layouts).
- `spec-dashboard/` — Vite + React. `src/data.js`'s `loadGraph()` fetches **`/api/graph`**; the x/y
  tidy-tree `layout()` is exported from `data.js` but **applied in `Dashboard.jsx`** (focus-driven
  drill-down — a pure view concern, the backend has no pixels). The live Sessions console is a **real
  terminal** (`SessionTerm.jsx`) over the `/api/sessions/:id/socket` WebSocket.
- `spec-eval/` — the measurement system behind the `spex eval` / `spex evidence` drawers: scenario
  schema, eval filings, freshness, and the content-addressed evidence store.
- `spec-forge` — a sibling package node, **built and `active`**: a host-agnostic, **read-only forge
  link tracer** that reads a forge's open issues/PRs and resolves each to the spec node it serves
  (git/`.spec` stays the single source of truth — a node's status stays git-derived). Real `spec-forge/`
  package (`src/{cli,links,port,cache,resident,needs-eval,drivers}.ts`, `src/drivers/{github,gitlab}.ts`)
  with active child nodes `forge-cli`, `dashboard-issues`, `forge-cache`, `forge-host`, `gitlab`,
  `links`, `needs-eval`, `port` (plus the `pending` `conformance-gate` subtree).

## Setup / onboarding

The pre-commit hook is **per-clone, not committed** (`.git/hooks/` is never in the repo), so a fresh
clone must install it once — that's the answer to "when do we set up the hook": **at onboarding, right
after install, before the first commit.**

1. `npm install` in each package you use (`spec-cli`, `spec-dashboard`).
2. `npm run hooks` — copies `spec-cli/templates/hooks/*` into the shared git hooks dir (covers every
   worktree). Re-run it whenever the hook source changes.

The hook is **advisory** — bypassable, and absent on any machine that skipped step 2. The real gate is
**CI running `spex spec lint`**; treat the hook as fast local feedback, CI as enforcement.

Adopting SpexCode on an existing project (no restructure needed — the layout seam handles where things
live):

1. Add `.spec/<area>/spec.md` nodes for the parts you want governed, each with a `code:` list pointing
   at the existing files.
2. Install the git hooks: copy `spec-cli/templates/hooks/*` into `$(git rev-parse --git-path hooks)`
   and mark them executable (adopter repos have no `npm run hooks`; `spex init` below does this for you).
3. Run `spex spec lint` — the **coverage** warnings are your adoption TODO: every source file not yet
   claimed by a spec. Work the list down.
4. If your layout differs from the default (main at root, worktrees in `.worktrees/`, `node/<id>`
   branches), drop a `spexcode.json` to point the tool at your structure instead of forking it.

`spex init` does steps 1–4's scaffolding in one shot: it seeds a starter `.spec/` tree (a root `project`
node + the default `.plugins` plugins), plants a starter `spexcode.json`, installs the hooks, and
**materializes** the harness artifacts. Materialize is the **base operation of harness adaptation** —
one pass renders the spec tree into whatever artifacts the selected harness auto-discovers: the
`<!-- spexcode -->` contract block in `CLAUDE.md`/`AGENTS.md`
(this guide's prose FOLLOWED BY the `surface: system` plugin bodies, which the harness auto-discovers) and
the harness shims (`.claude/settings.json`, `.codex/hooks.json`). Those materialized artifacts are **generated and
never tracked** (hidden via the per-clone `.git/info/exclude`) — regenerated per clone, kept fresh by the
git-native anchors (an unconditional materialize in pre-commit, plus post-checkout/post-merge refreshes;
no harness event ever triggers a materialize) — so a
fresh clone re-runs `spex init`/`spex materialize` rather than pulling them from git. This is the same
materialize that makes a self-launched agent already know the whole dev flow; the settings an agent tunes after
adoption (launchers, dashboard icon, lint policy, doctor health budgets) all live in those two `spexcode.json` /
`spexcode.local.json` files, documented in full by **`spex guide settings`**.
