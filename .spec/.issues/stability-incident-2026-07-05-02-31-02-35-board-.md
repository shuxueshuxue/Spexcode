---
concern: STABILITY INCIDENT 2026-07-05 02:31-02:35: board dishonesty under load caused a human mass-restore that killed live workers — three-part fix (board honesty, liveness listener-verify, resume guard)
by: 3ed32096-2012-466d-b194-d6c96d4781dd
status: landed
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

<!-- reply: 3ed32096-2012-466d-b194-d6c96d4781dd @ 2026-07-05T04:54:13.452Z -->
INCIDENT #2 (same night, 04:10-04:39) — two more mechanisms pinned:
(a) MASS DEATH ON BACKEND RESTART: backend restarted 04:10:29 (recovery from a wedge) → at 04:12:26-29, EVERY dispatched claude died within 3s of each other (~2min after boot — the first post-boot sweep window). Victims incl. the stability worker itself. Mechanism unpinned but the correlation is exact; the fix worker is investigating.
(b) RESUME LAUNCHER FLIP (why every revival failed all night): resume re-renders launch.sh with the CURRENT defaultLauncher instead of the session's ORIGINAL launcher. The launcher sets CLAUDE_CONFIG_DIR (claude-glm → /root/.claude-glm), so a flipped resume looks for the conversation in the wrong config dir → "No conversation found". Evidence: all four victims ran under reclaude (transcripts in /root/.claude) but their launch.sh had been rewritten to claude-glm. Manual recovery that works: resume with the transcript-home-matching launcher. FIX (4th tooth): resume must reuse the session's original launcher, never the current default.

<!-- reply: 3ed32096-2012-466d-b194-d6c96d4781dd @ 2026-07-05T06:40:42.275Z -->
CLOSING THE ROOT-CAUSE (controlled observation 06:30): restarted the wedged backend with a timestamped death-watch — NO mass death followed (+5.5min, all 6 sessions alive, health ok). The "post-restart mass death" is NOT a backend sweep; the 04:12 deaths were RESTORE-ON-ALIVE (human mass-restore attempts once the dashboard came back, same killer as incident 1). UNIFIED STORY, four compounding defects: (1) conn-leak wedges backend — child healthy-idle at ep_poll/0%cpu but 135 leaked conns piled (every client-side timeout-kill leaks one; one real user = pure leak) → board stale/unreachable → sessions LOOK dead; (2) resume has no alive-guard → mass-restore kills live agents; (3) resume re-renders launch.sh with the current defaultLauncher → CLAUDE_CONFIG_DIR flip → "No conversation found" → revival fails; (4) liveness stats the socket file → dead shows working → no alarm, more confusion. FIVE TEETH: board probe-fail honesty · liveness verifies listener · resume refuses on alive · resume reuses ORIGINAL launcher · server-side conn reaping (requestTimeout/headersTimeout/keepAliveTimeout on supervisor proxy + child so abandoned conns get reaped — kills the wedge at its start).
