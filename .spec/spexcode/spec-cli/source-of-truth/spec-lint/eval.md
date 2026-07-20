---
scenarios:
  - name: altitude-source-candidates
    tags: [cli]
    test: spec-cli/src/lint-source.test.ts
    description: >-
      Run the focused source-health cases through the real `spex spec lint` and bare `spex doctor` CLIs
      in temporary git repositories. Exercise a body that exceeds the former lint proxies, a tracked
      Python file, a tracked extensionless source file, a tracked file removed by `sourceExcludeGlobs`,
      and an untracked filename admitted only by `doctor.altitude.identifierExtensions`.
    expected: >-
      `spex spec lint` emits no altitude finding even when the body exceeds every proxy. Bare doctor
      reports structured altitude findings for repeated bare `foo.py` and extensionless `Makefile` names
      when those files are lint coverage candidates; an excluded `foo.py` is healthy. An explicit doctor
      extension admits an arbitrary matching filename by lowering to a wildcard candidate. Every command
      exits clean because health diagnosis is advisory.
  - name: govern-capped-at-one
    tags: [cli]
    description: >-
      On a tree where a spec node lists more than one file under `code:`, run `spex spec lint`. The
      node-side cap must fire as an ERROR (not a warning) — the `one-govern` rule — naming the node
      and its files and telling the author to keep the one true subject and demote the rest to
      related. A node with exactly one (or zero) govern file must NOT trip it. Reproduce by adding a
      second `code:` entry to any single-govern node, linting, then reverting.
    expected: >-
      `spex spec lint` reports `one-govern` at ERROR level for the >1 node (`'<node>' governs N files
      [...] — a node is source of truth for at most ONE`) and the run counts a non-zero error, so
      the pre-commit gate blocks. On the ≤1-govern tree the count is `0 error(s)` — the rule is
      silent at zero and one.
  - name: related-drift-is-soft
    tags: [cli]
    description: >-
      On a tree where files listed under nodes' `related:` have commits ahead of their node's spec
      version, run `spex spec lint`. The related (soft) tier must surface as a SINGLE summary warning —
      the count of related files across N nodes — never a per-file wall, never an error, and it must
      never block the commit gate or feed eval/ack (driftGate and eval attribution stay
      govern-only).
    expected: >-
      `spex spec lint` emits exactly ONE `related-drift` line at WARN level, of the form `<K> related
      file(s) across <M> node(s) drifted ahead of their spec (SOFT … never blocks, no ack, no
      yatsu)`, not one line per file; it adds 0 errors and the run still exits clean (the gate is
      unaffected).
  - name: cjk-id-chain
    tags: [cli]
    description: >-
      Prove a CJK node id is first-class on EVERY surface, deterministically — the id-format rule and
      the runtime must speak the same vocabulary. On a throwaway git tree, seed a CJK-named node
      (e.g. `评测视图`), a second unrelated CJK node (`会话看板`), and a sibling whose body mentions
      `[[评测视图]]`. Then measure one real probe per surface: (1) `spex spec lint` on the fixture;
      (2) `git branch node/评测视图-xxxx` in the fixture repo; (3) a real `spex serve` on the fixture,
      `GET /api/specs/<encodeURIComponent(id)>/content`; (4) `GET /api/graph` lists the node. Also seed one
      node with a space, one with uppercase Latin, and one with an underscore to prove the forbidden
      list still bites.
    expected: >-
      `spex spec lint` counts 0 error(s) for the CJK ids: `id-format` accepts them (whitelist —
      lowercase ascii `[a-z0-9-]` plus any non-ASCII unicode letter/number, one optional leading
      dot), the `[[评测视图]]` mention resolves, and `confusable-id` emits NO warn for the CJK ids
      (no cross-script or unrelated-pair false positive). The space/uppercase/underscore seeds each
      ERROR. The branch is created, the URL-encoded `/api/specs/:id/content` fetch returns the node body, and
      `/api/graph` contains it — one deterministic id, every surface.
  - name: name-rules
    tags: [cli]
    description: >-
      Prove the three graph-name rules bite and stay quiet correctly. On a throwaway git tree, seed
      nodes with (a) an uppercase/underscore dir name, (b) the same leaf dir name twice at different
      depths, (c) two sibling leaves one edit apart (graph/graphs), and (d) a body with a dangling
      prose mention, plus a backticked placeholder and a fenced sample mention. Run `spex spec lint`
      there, then on this repo's real tree.
    expected: >-
      On the fixture: `id-format` ERRORs on the bad charset AND on the duplicated leaf (naming both
      paths), `mention` ERRORs on the dangling prose mention ONLY (the backticked and fenced samples
      stay silent), `confusable-id` WARNs on the one-edit pair, and the run exits non-zero. On the
      real tree: all three rules report nothing and `spex spec lint` still counts 0 error(s).
---
# eval.md — spec-lint

Measured through the real `spex spec lint` and bare `spex doctor` CLIs (this worktree's source, run with
tsx), on temporary fixtures and this repo's own `.spec` tree. Two tiers of the [[governed-related]] link
are pinned: the node-side **govern cap** is a hard error that forces one source of truth; the **related**
tier is a soft, summarised warn that nudges but never blocks. YATU: the real CLI, not an internal helper.
