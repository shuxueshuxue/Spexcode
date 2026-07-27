---
title: ThinkPad fleet census
status: active
hue: 34
desc: A read-only, evidence-backed execution ledger for the current ThinkPad SpexCode session fleet.
code:
  - reports/thinkpad-session-fleet-census-2026-07-27.md
related:
  - spec-cli/src/host-resources.ts
  - spec-cli/src/sessions.ts
---

# thinkpad-fleet-census

## raw source

Cleanup preparation must explain every retained session before any lifecycle mutation is considered. The
current ThinkPad fleet census records the exact session store row, proposal, branch/worktree ancestry, unique
commits and evidence, child lineage, runtime ownership, and human or external references. It is advisory only:
it never stops, closes, archives, resumes, dispatches, or infers reclaim authority from age, archive labels,
idleness, or budget pressure.

## expanded spec

The ledger covers the live population observed in one snapshot: all archived rows and all non-archived direct
children of the governing session, with the census session itself excluded from the child count. Each row is
classified as KEEP, CLOSE-AFTER-ARCHIVE-FIX (including the explicit `CLOSE-AFTER-FE9` gate), or SALVAGE-FIRST.
A close queue is executable only after the
archive-to-offline fix is deployed and the exact process identity, loaded-thread set, worktree, branch, and
external references are re-probed immediately before each mutation. Shared control-plane references and the
explicitly protected sessions remain outside ordinary cleanup.
