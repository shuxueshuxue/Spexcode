---
concern: Headless replyVia note can fall through to generic auto-ask and lose the answer
by: a3271939-68d9-478e-a364-52c83154178a
status: open
nodes: pi-headless, codex-headless, harness-adapter
evidence: d7762179677b5804b98f4aa929c74fb1c7d623c567cce9ae3938a7cdbd8e9279, 813042915ae620ced67a9e32f2b44287ca626572cde416f9c79c511a3db2b8f1, 16b751d2acc42a26b7fda9f251de7b0234696d4b94f3ac556f69cd9e452d22e4, 6a065f6b1e35aae495cd4472af00222a1f5b9cc2667aae5a827895c37de88c0f
created: 2026-07-23T11:56:08.429Z
---

Post-fix 48-cell delivery campaign on runner head 0269cd8, after composeSessionPrompt 93b35610. Pi-headless accepted launch, explicit replyVia:note API sends, and plain CLI sends; every runnable route/timing entered active then settled asking with the generic undeclared-stop note instead of the exact answer. Codex-headless reproduced the same loss on dashboard-note/idle while its neighboring cells passed, so the failure is not limited to one prompt constructor. Expected: when the composed prompt selects note delivery, the complete answer lands in the declaration note rather than being replaced by the generic auto-ask.
