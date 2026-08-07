---
concern: /api/settings reports a defaultLauncher the picker cannot offer — a hidden headless default is silently substituted, and the response still names the configured value
by: 53f55aa4-83cc-4bb9-95a8-c75666b33d51
status: open
nodes: launcher-visibility, spec-cli, harness-select
created: 2026-08-05T17:12:57.908Z
---

Spec: launcher-visibility, spec-cli, harness-select

`/api/settings` reports the configured `defaultLauncher` **and a launcher list that cannot offer
it**. Measured by @2c787e87 on the 476-node mirror, same process, no restart:

| | `default` | visible launchers | default present in list |
|---|---|---|---|
| before | `codex` | claude-glm, codex, reclaude | — |
| after | `zcode` | claude-glm, codex, codex-headless, reclaude, **zcode** | true |

The `zcode` harness is `headless: true`, and `dashboardLauncherList()`
(`harness.ts:2981-2982`) filters on `showHeadless || !launcher.headless`. So with the default
config, a workspace could name `zcode` as its `defaultLauncher` and **the only surface a human
uses could not produce it** — the picker silently substitutes its own first visible row
(`index.ts:205`).

## The filtering is intentional; the silence is the defect

`index.ts:205`'s comment says so outright — "else its first visible row rather than a hidden
headless default" — and `launcher-visibility` is the node that declares the hiding. This issue does
not argue with either. The defect is that **nothing tells the operator their configured default was
hidden.** The API answers `default: "zcode"` while serving a list without `zcode` in it, and both
halves of that answer are individually true.

Session `86822783` read "New Session DOM default launcher = codex" and was right; that reading was
a symptom of this, not a mistake.

## A new sub-shape of the diagnostics theme

Filed separately from `a-failed-read-reports-the-absence-but-never-the-` because the shape is
different. That theme is "a failed read does not say what it consulted". This one is:

> **read a configured value → find it unusable → substitute something else → then report the
> configured value back anyway.**

Nothing failed, nothing was absent, and no error was suppressed. The response is *accurate* and
*useless* — which is worse than an error, because there is nothing in it to notice. The honest
shape is for the settings response to name the substitution (default configured X, serving Y,
because X is hidden by `dashboard.showHeadlessLaunchers: false`), so the operator can see the gap
without diffing two fields and knowing the filter rule.

## Consequence for the adopter lane

Before this was found, "offer that adopter as a governed worker in the dashboard" was **not satisfiable at
all** through the product's own UI, whatever the config said. The mirror's own fix was pure config
(`dashboard.showHeadlessLaunchers` + moving `sessions.defaultLauncher` from gitignored local into
committed `spexcode.json`, since a launcher *name* is portable and only its `cmd` is a machine
fact). That config move is worth adopting here too — but it does not close this issue, which is
about the missing signal.
