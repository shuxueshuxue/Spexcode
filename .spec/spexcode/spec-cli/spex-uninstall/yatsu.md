---
scenarios:
  - name: surgical-backout
    description: >
      In a git repo seeded with a SpexCode footprint AND the user's own data, run `spex uninstall` and
      inspect the tree + global store. Plant: a managed contract block inside a CLAUDE.md that ALSO has
      user prose; an AGENTS.md that is WHOLLY the managed block; a `.gitignore` with a user entry plus the
      managed `#` block; a `.claude/settings.json` shim stamped with `dispatch.sh`; a codex trust block in
      the global `~/.codex/config.toml` next to a foreign key; a `plugins/spexcode` bundle next to a
      foreign plugin; and the user's `.spec`/`.config` data. Run `spex uninstall` (no flags), then check
      what survived.
    expected: >
      Every SpexCode-generated artifact is gone — the CLAUDE.md managed block stripped (its user prose
      kept), the wholly-ours AGENTS.md deleted, the `.gitignore` block stripped (the user entry kept), the
      stamped shim removed, the codex trust block removed (the foreign key kept), the `plugins/spexcode`
      bundle removed (the foreign plugin kept), and the global per-project store deleted. The user's
      `.spec`/`.config` data is untouched, and the git hooks remain (only `--hooks` removes the
      spexcode-stamped ones). A second run is a clean no-op.
    tags: [cli]
    code: spec-cli/src/uninstall.ts
---

# measuring spex-uninstall

YATU through the real CLI entrypoint: `spex uninstall [dir]` (the `uninstall()` function the CLI route
calls), against a real on-disk git repo, NOT an internal helper. The proof surface is the filesystem +
the global store after the command runs — assert the SpexCode footprint is gone and the user's spec asset
and prose survived. `src/uninstall.test.ts` drives exactly this loop (seed footprint + user data → run
`uninstall()` → assert surgical removal) and is the transcript evidence for the reading.
