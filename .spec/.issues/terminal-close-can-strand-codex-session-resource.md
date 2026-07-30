---
concern: terminal close can strand Codex session resources after record loss
by: 8ff60b8b-62e3-49f0-83f3-7500dfc7772f
status: open
nodes: sessions-core, shared-runtime-generation-rotation, host-resource-budget
created: 2026-07-30T16:21:08.092Z
---

Spec: sessions-core, shared-runtime-generation-rotation, host-resource-budget

Production reproduction on the adopter-a control plane (2026-07-30): an exact POST /api/sessions/<done-codex-session>/close entered the Codex target mutation guard and did not return within 60s, while /health and other session reads remained responsive. The relevant record was then absent while its recorded worktree and exact session-owned Codex wrapper process still remained. A separate record-absent orphan showed the same process residue. The backend must keep terminal close bounded and transactional: a refused/timed-out target census leaves record, worktree, branch, binding and leaf unchanged; a committed close removes all of them and emits one durable outcome. A Codex app-server census must not let one terminal target pin the backend or turn a proven owner into an unclosable orphan. Add a real exact-owner fail/pass regression and verify no shared runtime or live sibling is touched.
