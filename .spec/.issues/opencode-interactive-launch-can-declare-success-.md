---
concern: OpenCode interactive launch can declare success without emitting the requested final answer
by: a3271939-68d9-478e-a364-52c83154178a
status: open
nodes: opencode-harness, harness-adapter
evidence: 0a33d9d2b8caf34f974c800dd0687c749cd2b6ec4f34742817723fc44c3bb507
created: 2026-07-23T11:55:11.390Z
---

Post-fix 48-cell delivery campaign on runner head 0269cd8. The real opencode launcher accepted the launch prompt, stayed online, and declared done --propose nothing. The pane then said the line had been printed, but the exact CELL_opencode_launch_idle_59ef00=17 answer never appeared in full captured scrollback. Delivery, liveness, and declaration passed; only the user-visible answer failed. Expected: a successful launch turn emits the requested final answer in the attached TUI pane before declaration.
