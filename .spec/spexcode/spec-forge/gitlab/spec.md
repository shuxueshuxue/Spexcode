---
title: gitlab
status: active
hue: 280
desc: The second ForgeDriver — self-hosted/SaaS GitLab over REST API v4 (fetch + PAT). Issues and merge requests by per-project iid; base-url + project parsed from the origin remote; token from GITLAB_TOKEN env or git's credential store, never a config value.
code:
  - spec-forge/src/drivers/gitlab.ts#gitlabDriver
  - spec-forge/src/drivers/gitlab.ts#parseRemote
  - spec-forge/src/drivers/gitlab.ts#credentialToken
related:
  - spec-forge/src/port.ts
  - spec-forge/src/drivers.ts
---
# gitlab

The [[port]]'s second driver, proving the seam is real: a GitLab host (SaaS or self-hosted, e.g.
z-code's `dev.aminer.cn`) behind the same driver shape, selected by host id — product code never
learns a second vendor. Registration is one registry entry; host *selection* stays out of scope
(that is forge-host's boundary).

**Transport is direct REST over the platform's HTTP client** — no CLI shelled out, because none
exists to lean on (GitHub's CLI doesn't speak GitLab and no GitLab CLI is installed where this
matters). That forfeits the github driver's trick of borrowing a CLI's auth and repo-detection, so
the driver rebuilds both, thinly:

- **Where** — the origin remote, parsed into the host's base URL plus the project path (both the
  https and the ssh remote forms collapse to the same pair). Nested subgroups survive because the
  project path travels URL-encoded as the API's project id.
- **Who** — the token is never a config value (secret values stay out of the config files, per the
  config discipline): a token env var first, else **git's own credential store**, read-only with
  prompting disabled — the same personal access token a push to that host already uses, so a
  machine that can push can trace, zero extra setup. No token → fail loud with the repair line.

**Mapping — the vendor dialect dies here, per the port's contract:**

- An issue's or merge request's number is its **per-project iid** (what a human sees as `#N` on the
  host and what a closes-reference names), never the instance-global id.
- GitLab's open state says `opened`; it normalizes to the port's canonical `open`, which downstream
  filters compare against.
- A **merge request** is the port's PR: its source branch is the head ref (the `node/<id>`
  structural link), and the issues it closes come from the host's own closes-issues read per open
  MR — GitLab already resolved the description server-side, so the driver never regex-hunts for
  closes-lines itself.
- Comments are **notes** minus system notes (lifecycle noise isn't discussion). GitLab's list read
  can't embed threads, so each *commented* issue's notes are fetched alongside — the note count
  gates it, so the common uncommented issue costs nothing and [[forge-cache]]'s TTL covers the rest.
- The **incremental window** rides GitLab's updated-after filter, the direct analog of GitHub's
  since-window; GitLab's issue list never mixes MRs in, so nothing needs filtering out.

The write verbs mirror the port exactly: create an issue, comment on one (the permalink is
constructed from the host's stable issue-note anchor form), close one. All fail loud — a bad token
or dead host throws with the HTTP status, so a broken GitLab never looks like an empty forge.

Out of scope: link resolution ([[links]]), host selection for the resident/board read (forge-host),
and any GitLab-specific link source beyond the port's shapes.
