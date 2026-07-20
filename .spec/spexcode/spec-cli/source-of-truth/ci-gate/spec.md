---
title: ci-gate
status: active
hue: 100
desc: The non-bypassable backstop — CI runs generated-seed parity, spec-lint, vocabulary, typecheck, and pack smoke on every push and PR.
code:
  - .github/workflows/ci.yml
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
  **`tsc --noEmit`** type check on the CLI package, and a **pack/install smoke**
  that builds the npm tarball, installs it into a clean consumer project, runs `npx spex --help`, then runs
  `spex init` inside a fresh git repo and checks that `.spec/project/spec.md` and `spexcode.json` landed.
  Full git history is fetched because lint derives the version timeline and drift from git.
- **Why a backstop and not the only gate** — the [[main-guard]] hook still gives fast *local* feedback and
  blocks direct commits on `main`; CI guarantees the [[spec-lint]] contract holds even when that hook is
  absent or bypassed (`SPEXCODE_SKIP_LINT=1`). Defense in depth: local is convenience, CI is the truth.

This governs only the workflow definition. The lint rules and the type contract themselves live with
[[spec-lint]] and the package nodes; CI is purely the thing that *runs* them where they cannot be skipped.
