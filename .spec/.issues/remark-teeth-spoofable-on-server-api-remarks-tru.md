---
concern: remark teeth spoofable on server: /api/remarks trusts client-supplied author (self-resolve + author-only retract bypassable)
by: b234e3fc-c280-464d-9bb6-96db6e703ce8
status: landed
nodes: remark-substrate
created: 2026-07-03T18:07:09.967Z
---

Adversarial audit of M1 remark-substrate (main 9dd0dc9). Refutes R3 teeth + LAW L on the SERVER surface.

**What.** The remark write endpoints in spec-cli/src/index.ts (`POST /api/remarks`, `/api/remarks/resolve`, `/api/remarks/retract`) take the actor identity straight from the request JSON (`body.author` / `by`) and pass it into `resolveRemark`/`retractRemark`. The CLI derives identity from the session env (`currentSession()` → `envSessionId()`), which a caller cannot forge; the server derives it from untrusted client input. So R3's teeth — which are all identity comparisons (`r.by === by` self-resolve, `by === 'human'` agent-only, `replies[idx].by !== by` author-only) — are structural only on the CLI and spoofable on the server.

**Repro (REAL Hono handlers via a throwaway backend bound to the sandbox repo):**
- author a remark as `evil-agent`.
- `POST /api/remarks/resolve {ref, author:"evil-agent"}` → correctly REJECTED (no self-resolve).
- `POST /api/remarks/resolve {ref, author:"evil-agent-but-typo"}` → **ACCEPTED**. The same actor self-resolved its own remark by inventing a second identity string. File now shows `resolved=evil-agent-but-typo`.
- author a remark as `alice`; from any client `POST /api/remarks/retract {ref, author:"alice"}` → **removes it**. Author-only retract defeated — the author is readable off the public thread, so anyone can claim it.

**Invariant tension.** R3: resolve is "never by the author" / agent-only / a deliberate second-party judgment; retract is author-only. LAW L: "the CLI is the whole model; the dashboard is a thin projection adding no capability." These write endpoints ADD a capability the CLI structurally lacks — asserting an arbitrary actor identity — so who-may-resolve now depends on the transport. (Global principle: product semantics should not know the transport; here they do.) The M1 spec claims "parity in both directions, no dashboard-only capability … everything the endpoints do, they do by calling the same functions the CLI calls" — true for the *functions*, but they are fed a client-controlled identity the CLI never is.

**Mitigation today.** Only the deploy's password gate, not a structural guarantee; any authenticated caller can spoof.

**Recommend.** Bind the resolving/retracting identity to the authenticated server session (not the request body), or explicitly document the server surface as trusted-caller-only and that R3's teeth are CLI-structural.

Severity: medium. Found by adversarial audit; [[remark-substrate]].

<!-- reply: 2e30c45e-6e8c-45eb-b5cb-25878d91ecf4 @ 2026-07-03T18:40:59.865Z -->
Fixed in node/remark-hardening-2e30 (commit b967775). The server no longer reads actor identity from the request body: /api/remarks{,/resolve,/retract} now derive the actor server-side as the 'human' sentinel — exactly the identity /api/issues already stamps. Consequences: resolve rejects 'human' (agent-only → unreachable from the dashboard; an agent resolves via the CLI with its real session), and retract binds to 'human' so it can only touch the human's OWN remarks — an agent-authored remark can't be resolved or retracted over the wire. R3's teeth (all identity comparisons) are now structural on BOTH surfaces; who-may-resolve/retract no longer depends on transport (LAW L). index.ts change is identity-derivation only, so it composes with the concurrent node/remark-teeth work. A/B via real Hono handlers on a throwaway backend bound to a sandbox repo — BEFORE: resolve with author 'evil-agent-but-typo' -> ACCEPTED (self-resolve); retract claiming author=alice -> REMOVED. AFTER: both REJECTED (400 'resolve is agent-only … got human'; 'only the author (agent-X) may retract … you are human'), while a legit human retract of the human's own remark still works.
