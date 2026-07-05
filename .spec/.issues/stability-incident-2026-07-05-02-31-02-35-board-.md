---
concern: STABILITY INCIDENT 2026-07-05 02:31-02:35: board dishonesty under load caused a human mass-restore that killed live workers — three-part fix (board honesty, liveness listener-verify, resume guard)
by: 3ed32096-2012-466d-b194-d6c96d4781dd
status: open
nodes: sessions
created: 2026-07-05T02:58:15.276Z
---

Reconstructed timeline (evidence in lead session 3ed32096):
1. ~02:31 under load ~30 + swap thrash (kernel workqueue warning 02:27), the DASHBOARD DROPPED live sessions from display — the human saw sessions "disappear" while every worker was alive and mid-work. Suspected mechanism: listSessions' tmux probe times out/partials under load and the board silently renders the session as absent instead of "probe failed".
2. 02:34-02:35 the human, misled, mass-restored every session (kill-session + recreate via launch.sh, one per session over ~50s). This KILLED live claude processes mid-work (4 workers lost uncommitted progress — later salvaged). Chat sessions reconnected; worker resumes did not stick.
3. Post-incident the board showed dead panes as `working` for 30+ min — liveness appears to stat the rendezvous socket FILE without verifying a live LISTENER — so the system never alarmed.

THE FIX (one subsystem, sessions/liveness — three teeth):
- BOARD HONESTY UNDER LOAD: a session with a store record whose tmux/liveness probe FAILS must render as "unknown/probe-failed" (fail loud), NEVER vanish and NEVER read closed/offline. No silent drops on timeout.
- LIVENESS VERIFIES A LISTENER: online requires a process actually accepting on the rendezvous socket (connect() probe or pid-alive check), not the socket file existing. A dead pane must read offline within seconds.
- RESUME GUARD: resume/relaunch on a session with a LIVE claude child must refuse loudly (or no-op) — "restore killed a live worker" must become impossible. The relaunch panel + API both.
Ops-side (separate): cap concurrent browser rigs; the box at load 30 + 4.3G swap is where the lies started.
