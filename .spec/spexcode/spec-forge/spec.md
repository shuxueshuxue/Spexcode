---
title: spec-forge
status: active
session: 3def572e
hue: 280
desc: A forge link tracer — reads a forge's open issues/PRs and resolves each to the spec node it serves (issue-body marker + node/<id> PR branch). Read-only; a node's status stays git-derived.
---
# spec-forge

A sibling package (alongside spec-cli, spec-dashboard, spec-yatsu) that relates an external **forge**'s
work objects to the spec graph. The two are different *kinds* of thing on different axes: a spec node
**defines** (the condition/need), while a forge **issue/PR does** (the working process toward it). An
issue is therefore not a node mirrored out — it is the work spawned by the gap between a node and reality.
So spec-forge does not project the graph onto a forge; it **reads the forge and links its work back to the
nodes that work serves.**

The bridge is a single host-agnostic **[[port]]** (`ForgeDriver`) that *reads* a host's open issues and
PRs; per-host drivers sit behind it (`github` via `gh` today; gitlab/bitbucket later). The host-agnostic
**[[links]]** resolver then inverts that raw work into `node → { issues, prs }`. The capstone **[[forge-cli]]**
exposes it on the real CLI as `spex forge links`. Downstream, this read also feeds the **unified Issue
port** (spec-cli's [[issues]]), where a forge issue and a local issue thread are the same object behind
per-issue storage — this package stays that object's read-only remote adapter.

**How a forge object names its node — three sources, no datastore of our own:**

- **PR branch (free):** a PR heading off `node/<id>` is structurally bound to that node — the convention
  SpexCode worktrees already use, no marker needed.
- **Issue-body marker (the one convention):** an issue body line `Spec: <node-id>` (comma-separated for
  several) names the node(s) it serves. Chosen over labels because it needs no per-node label
  pre-creation and scales to any number of nodes while staying human-visible.
- **Transitive (free):** an unmarked issue still links through a PR that closes it on a node branch
  (issue ← `closingIssuesReferences` ← PR → node).

The non-negotiable contract: **git/`.spec` is the single source of truth.** The forge owns *execution*
(its issues/PRs), the graph owns *definition*, and the two authorities never cross. Definition flows
DOWN (a node motivates work); the tracer never writes a node's version or status — a node's status stays
**git-derived** (`deriveStatus`), so the only execution fact that reaches the graph (a merge) arrives
through git, never through this package.

Out of scope: any write *to* a forge from the **tracer** (the [[port]] does carry one write verb —
`createIssue`, used solely by the Issue port's promotion in spec-cli's [[issues]] — so the driver stays
the single network seam; the tracer itself never writes), and surfacing links in the dashboard (a sibling
node — this package is CLI-first because frontend can't be verified here).
