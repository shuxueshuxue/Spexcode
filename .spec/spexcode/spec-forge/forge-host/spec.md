---
title: forge-host
status: active
hue: 280
desc: WHICH forge a repo talks to is a repo fact, not a constant — resolveForgeHost() derives the host from the origin remote (github.com → github, gitlab/self-hosted forms → gitlab), an explicit forge.host config overrides, and a resolved host with no registered driver degrades to an empty slice, never a wrong-host call.
code:
  - spec-forge/src/drivers.ts
---
# forge-host

The host-selection seam of [[spec-forge]]. The [[port]] made the driver shape host-agnostic, but every
consumer still *chose* the host as a constant — the resident cache hardwired the github driver, the
board/issues slices said `host: 'github'` literally — so a repo whose remote is not GitHub (z-code's
self-hosted GitLab) rendered a permanently empty Issues surface with no path to a different answer.
This node makes the choice a **derived repo fact**: `resolveForgeHost()` reads it from the repo itself,
and every "this repo's forge" consumer — the resident cache, the board/issues fold, promotion, the
`spex issues` live pull, `spex forge`'s default — asks the seam instead of naming a vendor.

**Resolution ladder, most explicit first:**

- `forge.host` in `spexcode.json` / `spexcode.local.json` (local wins, same layering as every other
  setting; documented in `spex guide config`). The escape hatch for a domain the heuristic misreads.
- the **origin remote's hostname** (`git remote get-url origin`, both URL and scp-like shapes): a
  github domain → `github`, bitbucket → `bitbucket`, and **any other resolvable host → `gitlab`** —
  the common self-hosted forge shape (e.g. `dev.aminer.cn`), deliberately a guess because a wrong
  guess costs only an empty slice (next clause) while "unknown means github" was simply wrong.
- no repo / no origin → `DEFAULT_FORGE_HOST` (`github`), the pre-seam behaviour.

**The degrade contract — resolved host without a registered driver.** The registry (`FORGE_DRIVERS` /
`forgeDriverFor`) stays the single meeting point: a new host lands by adding one driver entry, nothing
here changes. Until that driver exists, a resolved-but-driverless host (gitlab today) must degrade to
an **empty forge slice** — the resident cache skips the cycle without spawning anything, the store
list offers no forge store (scoped to the resolved host, so a gitlab repo never sees a `github` New-issue
target), and the board/issues surfaces carry the local slice alone, no error. This is what lets a
gitlab *driver* be built and verified independently: the seam routes to it the moment it registers.
Write verbs differ deliberately: an explicit write (promote, `--store <host>`) against a driverless
host **fails loud** naming the resolved host — a silent no-op write would fake closure.

The seam lives in spec-forge and reads git/config itself (env-stripped like spec-cli's `git()` helper,
so hook-context calls still discover the repo), because its callers include spec-forge-internal code
(the resident cache) that must not depend back on spec-cli. Resolution is memoized briefly; a config
edit takes effect within seconds, not process lifetime.

Read-only throughout: resolving a host reads a remote URL and two config files — git/`.spec` stays the
single source of truth, and nothing here touches the network or a node's git-derived status.

Out of scope: the gitlab driver itself (a sibling node adds the registry entry), per-repo multi-forge
(one repo, one resolved host), and moving platform normalization — that stays at the drivers ([[port]]).
