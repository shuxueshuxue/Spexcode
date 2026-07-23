---
concern: A valid note declaration can disappear from the session timeline after a later status
by: a3271939-68d9-478e-a364-52c83154178a
status: open
nodes: session-timeline, opencode-harness, harness-adapter
evidence: d2c1597c9923e331e719fba5704ba25b62a608be361566c0a6fcfa743af35ae2
created: 2026-07-23T11:55:30.360Z
---

Post-fix 48-cell delivery campaign on runner head 0269cd8. During opencode dashboard-note/in-turn, POST /input replyVia:note returned 200. The model produced CELL_opencode_dashboard_note_in_turn_abafcd=17 and successfully ran done --propose nothing --note with that token; the live board transition exposed the note. A later stop-gate status replaced the current declaration, and the timeline endpoint never retained a status event carrying the answer, so the terminal-free client could not read it. Expected: every landed declaration note remains durably readable in the session timeline even if a later status follows.
