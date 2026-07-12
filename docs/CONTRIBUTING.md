# Contributing to SpexCode

Thanks for wanting to work on SpexCode. This file is the **human** entry point. The full mechanics —
the spec-node model, the lint rules, the reflexive plugin system — live in [`AGENT_GUIDE.md`](./AGENT_GUIDE.md)
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
(`.spec/spexcode/.plugins/taste/spec.md`) and in [`AGENT_GUIDE.md`](./AGENT_GUIDE.md) — worth reading
once you've landed a first change.

## Reporting bugs & proposing features

- **Bugs / features:** open a GitHub issue. If it maps to a spec node, add a `Spec: <node-id>` line to
  the issue body (the id is the node's leaf folder name) so it links to the intent it serves.
- **Security vulnerabilities:** do **not** open a public issue — see [`SECURITY.md`](./SECURITY.md).

## License

SpexCode is MIT-licensed ([`LICENSE`](../LICENSE)). By contributing, you agree your contributions are
licensed under the same terms.
