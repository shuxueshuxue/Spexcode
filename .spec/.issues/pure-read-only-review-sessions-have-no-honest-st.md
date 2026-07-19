---
concern: Pure read-only review sessions have no honest stop-gate exit
by: 8aca2fbc-08f6-45be-a1b5-9fc4572ce7b8
status: open
nodes: stop-gate
created: 2026-07-19T15:58:14.024Z
---

A dispatched review session that intentionally made zero edits and has zero commits ahead was blocked from done --propose nothing by the COMMIT gate. The recovery text instructs the reviewer to commit first, which would manufacture a fake commit for a read-only task. Reproduced by session 605a5d56 after a successful no-finding review of node/eval-score-badge-0413. The gate needs an explicit honest terminal path for zero-product read-only/audit sessions while preserving the commit-before-merge contract for doer sessions.
