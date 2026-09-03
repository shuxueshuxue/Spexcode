---
concern: machine-peer's login-shell scenario has no harness that avoids a live peer store
by: 8bb006f2-ff07-46c9-a216-83c6e32f7777
status: open
nodes: machine-peer
created: 2026-09-03T12:31:44.514Z
---

Spec: machine-peer

`remote-command-resolves-in-login-shell` went stale on node/hi-8bb0 and the staleness is MINE: the reading was
fresh at main (its codeSha 497933c..main leaves spec-cli/src/machine-peer.ts untouched), and commits 1b1732c15
+ db8b55e81 added 110 lines to that file. So this is not pre-existing drift to report — it is a fresh reading
this branch broke, and it is owed a real re-measurement.

What I could measure over REAL ssh, with zero state mutation: the tool's exact remote-command shape
(exec "$SHELL" -lc 'spex internal peer-accept <b64>') over a real loopback ssh hop resolves spex through the
login shell and returns a structured spex reply. That is a genuine test of the mechanism my change touched,
because on this host the bare ssh PATH really does lack ~/.local/bin while the login shell has it — the
scenario's premise holds without any faking. A deliberately invalid payload made it fail validation before
writing, and the live gateway's peers.json mtime was unchanged afterwards, confirming no write.

What is NOT measured, and why it is blocked rather than skipped: the mutual connect in both directions, the
login-greeting tolerance, and the tool's translation of a raw `spex: not found` into its named error all
require the TOOL to own the ssh call, which makes the far side run `spex internal peer-accept` and write a peer
record into the far machine's spexcode home. On loopback that home is this box's LIVE gateway store, and on
macmini/mbp it is a live dogfood deployment's. SPEXCODE_HOME cannot cross the hop (sshd AcceptEnv is unset) and
the routes that would force it — an sshd config change, a shim earlier on the login PATH, or editing the login
profile — all perturb a live deployment for the sake of a reading. Not a trade worth making.

What would unblock it: a second host with spex on its login PATH and NO live gateway, or a peer-accept path
that can be pointed at an alternate spexcode home from the asking side (an ssh option carrying the far home,
say), which would make this scenario measurable in a sandbox the way the two-gateway fleet scenario already is.

Until then the scenario stays honestly stale. Filing a --pass off the resolution half alone would assert the
two halves I did not measure.

<!-- reply: 8bb006f2-ff07-46c9-a216-83c6e32f7777 @ 2026-09-03T12:37:10.701Z -->
Adding the cost that makes this a refusal rather than a deferral, raised by 0c76e919.

The three routes that would force an isolated home across the ssh hop — changing sshd config, putting a shim
earlier on the login PATH, editing the login profile — do not merely touch a live deployment. They perturb the
very environment other readings are measured in. The live gateway, its peer store and its login PATH are the
measurement environment for every other real-ssh and real-browser scenario on this host. Contaminating it to
measure ONE scenario trades the whole batch of readings for one green dot.

So the ordering is not "measure unless it is inconvenient" but: a measurement may not degrade the instrument
other measurements depend on. That is why this scenario stays stale with a named blocker instead of being
measured through a modified host.

Also recording a second latent trap found while attributing this: a scenario's `code:` anchor may carry a
symbol suffix (`spec-cli/src/doctor.ts#doctor`). Handed to `git diff` as a pathspec it matches nothing and
returns empty, which reads as "this anchor did not move" — a false clean. Six of the 64 currently flagged
scenarios use that form. Stripping the suffix to the file path left the attribution unchanged (63 already stale
at main, 1 caused by node/hi-8bb0), because all six also carry plain file anchors that had already moved — but
any tooling that reasons over anchors must strip the suffix before touching git, or it will silently under-report.
