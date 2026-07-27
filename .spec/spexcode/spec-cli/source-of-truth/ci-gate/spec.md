---
title: ci-gate
status: active
hue: 100
desc: The non-bypassable backstop — CI runs generated-seed parity, spec-lint, vocabulary, typecheck, and a production clean-init matrix on every push and PR.
code:
  - .github/workflows/ci.yml
related:
  - scripts/clean-init-smoke.mjs
---
# ci-gate

The dogfood ritual is advertised as "hook-enforced", but the git hooks are **advisory and per-clone**:
they live in `.git/hooks` (never committed), so a fresh checkout that skipped `npm run hooks` has *no*
gate — and nothing surfaces that gap. CLAUDE.md already names CI as the *real* gate; this node makes that
true instead of aspirational.

CI is the **non-bypassable** layer that runs on the forge, not on a developer's machine:

- **When** — every push to `main` and every pull request. A merge to `main` is therefore always checked,
  and a node branch is checked before it lands.
- **What** — the same gates the manager weighs at review plus the published-user smoke: generated
  [[init-preset]] parity (every adopter plugin byte, path, and executable bit is the canonical projection),
  **`spex lint`** (fails on graph errors; coverage and drift stay advisory), the **[[dead-words]] gate**
  (retired vocabulary cannot reappear on product surfaces), the
  **`tsc --noEmit`** type check on the CLI package, the CLI package's complete **unit/integration suite**, and
  one data-driven **production clean-init matrix**. The suite runs from the package directory after both root
  and package installs, so subprocess fixtures resolve the same local `tsx`/TypeScript that production-facing
  tests invoke; a green workflow cannot coexist with a known main-branch unit failure.
  The matrix builds and installs the npm tarball, proves the installed `spex` starts, then crosses Python and
  TypeScript projects with Claude-only and Codex-only delivery in disposable real git repositories. Every row
  goes through the actual `spex init` and `spex materialize` CLI surfaces and checks the whole deterministic
  self-launch boundary. After init, it follows the printed adoption repair with ordinary Git: stage exactly
  `.spec` and `spexcode.json`, commit them through the installed hooks (the documented main-seeding allowance,
  never `--no-verify` or a lint bypass), and prove that commit reaches every project source asset while the
  local-only source and generated harness files remain untracked. Then git-tracked source is visible to coverage
  while untracked source is not; init's receipt
  names only artifacts it actually planted for the selected harness; the starter launcher is that harness's
  plain command with no automatic-permission flags; the seeded plugin tree is the canonical [[init-preset]]
  projection byte-for-byte and mode-for-mode; no held-back, private-machine, or SpexCode-project text leaks into
  the adopter; and `spex spec lint` finishes with zero errors. It never starts a harness, attempts login, or
  reaches a harness/network service — session launch is beyond this gate. Every failed child command is
  reported with its captured stdout and stderr as separate, labelled sections; the production install itself
  does not opt into npm's silent mode, so an offline-cache miss names the missing package instead of collapsing
  into an exit code. The offline consumer uses the public root lockfile as its exact dependency plan, after a
  root `npm ci` has both validated that plan against the published manifest and cached its platform artifacts.
  A bare tarball install cannot honestly rely on those artifacts alone: dependency ranges make npm request
  registry packuments even when every selected tarball is cached. The lock-driven `npm ci --offline` proves the
  packed package and its exact production graph install with no registry access instead of depending on warm,
  machine-local metadata.
  Full git history is fetched because lint derives the version timeline and drift from git.
- **Why a backstop and not the only gate** — the [[main-guard]] hook still gives fast *local* feedback and
  blocks direct commits on `main`; CI guarantees the [[spec-lint]] contract holds even when that hook is
  absent or bypassed (`SPEXCODE_SKIP_LINT=1`). Defense in depth: local is convenience, CI is the truth.

This governs only the workflow definition. The lint rules and the type contract themselves live with
[[spec-lint]] and the package nodes; CI is purely the thing that *runs* them where they cannot be skipped.
