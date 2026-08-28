---
title: spec-cli
status: merged
session: sess-design
hue: 200
desc: The server + CLI — reads .spec and git, serves the API, and houses the source-of-truth guards.
code:
  - spec-cli/src/index.ts
related:
  - spec-cli/src/eval-host.ts
related:
  - spec-cli/src/reaper.ts
  - spec-cli/src/reaper.test.ts
  - spec-cli/src/supervise.ts
  - spec-cli/src/listen.ts
  - spec-cli/src/slash-commands.ts
  - spec-cli/src/guidance-catalog.ts
---
# spec-cli

The backend package is `@spexcode/spec-cli`; its declared dependencies are `@spexcode/spec-core`,
`@spexcode/session-application`, `@spexcode/session-selflaunch`, `@spexcode/transcript`, `@spexcode/spec-eval`, and `@spexcode/spec-forge`. It is the composition boundary that installs spec-eval's
host port with the session, issue, source-policy, and transport implementations.
`eval-host.ts` is that one-way composition seam: it installs the concrete CLI capabilities at startup and does
not duplicate the eval engine or its remark types. Its defining contract has a focused governance node.

## raw source

One of the SpexCode packages (with spec-core, the session package stack, spec-eval, spec-forge, and spec-dashboard). It is the server + CLI: read the
`.spec` tree and its git history, serve them over an API, ship the `spex` CLI, and house the
**source-of-truth** guards (git-as-database, the worktree linker, the guards, the linter) here — under
the CLI where they belong, not under the dashboard. It publishes compiled JavaScript; TypeScript remains
development source rather than a consumer runtime requirement.

## Dependency arrival and subtraction ledger

This is the cross-package history for the dependency rule: when a package edge arrived, this table names the
predecessor it replaced or records why no package edge existed. Workspace package extractions are included because
they are dependency arrivals for the published composition even when their manifest has no third-party dependency.
Version-only release bumps and script-only edits are intentionally omitted. `No package predecessor` means the
feature had no prior package edge; it is an explicit exception, not an unexamined omission.

| Commit | Arrival | Predecessor or same-change subtraction |
| --- | --- | --- |
| `2a5560b11` | `spec-cli` added `@hono/node-ws` and `node-pty` for the first terminal WebSocket/PTY transport. | **No package predecessor:** the backend had no terminal transport dependency; the old boundary was in-tree code, not a package edge. |
| `f19ce3af2` | Dashboard added `@xterm/addon-canvas` and `@xterm/addon-webgl` as optional xterm renderers. | **No package predecessor:** xterm's built-in renderer remained the fallback; these were optional acceleration edges, not a second terminal implementation. |
| `59f51a6b0` | Dashboard removed `@xterm/addon-canvas`. | Same-change subtraction: the code-split shell no longer imported or registered the canvas addon. |
| `bbd00164a` | Dashboard removed `@xterm/addon-webgl` while moving xterm to 6.0 and fit to 0.11. | Same-change subtraction/version replacement: WebGL registration was removed with the old renderer path; the xterm core upgrade is the retained edge. |
| `0962fb0e0` | Dashboard added `markdown-it` and `katex` for RichText. | **No package predecessor:** the prior prose and math boundaries were local renderers, not replaceable package edges. |
| `7e90b791d` | Extracted `@spexcode/l0` as the workspace core package. | Source ownership moved out of `spec-cli/src` (anchors, git/layout, graph, identity, resilience, specs, review snapshot, root-LRU); Git renames prove no duplicate implementation remained. |
| `023e91b4c` | Renamed `@spexcode/l0` to `@spexcode/spec-core`. | Same-change replacement: package name and path were renamed; `@spexcode/l0` did not remain as a second edge. |
| `dff2d31c7` | Made `@spexcode/spec-core` importable and packable outside the monorepo. | The internal-only source package became the published boundary; no second core implementation was added. |
| `2f8d5fb71` | `spec-core` added `@vscode/tree-sitter-wasm` for asynchronous syntax anchors. | Same-change replacement: the prior regex extractor in `packages/spec-core/src/anchors.ts` was replaced by the Tree-sitter extractor. |
| `3d0e60e6b` | Formalized `spec-cli` edges to `@spexcode/spec-core`, `@spexcode/spec-eval`, and `@spexcode/spec-forge` and exposed package exports. | Same-change subtraction: dashboard/CLI relative imports were replaced by public package edges; no parallel relative implementation remained. |
| `377c832f4` | Extracted the first session protocol package. | Historical extraction; the package was later retired after the application cutover. |
| `b1c36fb04` | Added `@spexcode/session-application` and `@spexcode/session-selflaunch` to `spec-cli`. | Same-change extraction: application composition and self-launch adapter implementations moved out of the CLI; the old copies were removed. |
| `0443c68df` | Removed the retired `@spexcode/session-core` workspace edge. | Same-change subtraction: root build, launcher source closure, release plan, CI, lint roots and lockfile no longer build or ship the legacy package. |

The table is an immutable-history ledger, not permission to add a dependency without a review. A future edge must
either name its same-change subtraction here or add a measured **No package predecessor** exception with an owner and
an executable boundary check.

## expanded spec

`spec-cli` is the backend. It owns the read path (turn `.spec` + git into JSON) and the write path
(the `spex` CLI driving worktrees/sessions); the dashboard is a thin HTTP caller. `index.ts` is the
HTTP entrypoint — a Hono app that wires the loaders and the session state machine to routes — and is
the file this node governs (the deeper mechanism lives in its [[source-of-truth]] subtree; the
eval endpoints' contract belongs to [[spec-eval]], so their churn — the eval-blob comment reframed to
serve a transcript or image, not just pixels — is that subtree's evolution, not spec-cli's drift).
Its bounded Eval-detail route resolves a requested worktree scope before it resolves the addressed
scenario: a vanished scope is explicitly reported as a fallback to trunk, while a declared-but-unmeasured
scenario and a scenario absent from trunk remain separate response states. The HTTP seam never turns one
of those facts into another by returning a generic missing review source.

A CLI output contract, in the same fail-loud spirit: a verb with unbounded stdout (`issues --json`,
`board`, `review --json`, `eval ls --json`, …) must FULLY reach a pipe. `process.exit()` force-quits
without draining buffered pipe writes, silently truncating a large dump at the ~64KB pipe buffer, so those
verbs exit through a shared **flush-then-exit** helper that waits for stdout to drain first — a >64KB piped
board or issue dump arrives whole, never a JSON cut off mid-object that reads as complete.

The `serve` script (the `npm run api` entry) hot-reloads the backend on changes to **any source tree in the
compiled runtime closure** — its own `spec-cli/src/**` plus the sibling packages it loads at runtime
(`spec-forge`, `spec-eval`, `spec-core`, `transcript`, `session-application`, `session-selflaunch`) — never on `.spec/**/spec.md` or `spec-dashboard` edits, which it
reads via fs or never imports (the frontend is a separate vite server with its own HMR). In a source workspace
the supervisor rebuilds that closure before it reloads; an installed package watches only its shipped `dist`.
Watching only its own dir was a real gap: a merge touching `spec-forge` reached disk while the running child
kept the stale code, so a fix could ship to `main` yet stay invisible on the live dashboard. **The reload must
be zero-downtime: port 8787 never has a gap.** A process restart left a ~1-2s window where every API call was
refused (a node merge touching backend code took the dashboard down); that window must not exist.

The mechanism is a tiny **supervisor** (`serve` runs `supervise.ts`) that owns the public port as a
raw-TCP proxy and runs the real Hono server as a child on a private port. On a source change it boots a
fresh child, waits for `GET /health` (a cheap, git-free readiness probe), atomically flips the proxy to
it, then **gracefully drains** the old child — which stops accepting new connections but finishes
in-flight requests before exiting. The public socket never closes, so the flip is invisible. (SO_REUSEPORT
is the obvious alternative but is unsupported on this platform, hence the proxy.) An unhealthy new child
is discarded and the current one kept, so a broken edit degrades to "still serving old code", never a gap.
Live ws/pty bridges drop and reconnect; detached tmux sessions survive untouched. (Under `spex serve
--public` the supervisor's raw proxy retreats to a **loopback** port and the password-gated [[public-mode]]
gateway takes the public port — loopback stays the trusted face local agents reach; the gateway is the
internet face. Default `serve` is unchanged: the proxy itself owns the public port.) The dashboard also
retries a transient failure with bounded backoff, so a poll landing on the flip is masked. Because the
child binds a **private** port that changes on every reload, the supervisor hands it a fixed
`SPEXCODE_API_URL` at the **public** port; every session the child launches inherits it, so a launched
agent's own `spex` calls reach the stable public endpoint instead of chasing a retired child's port.
That injected URL is **deterministic — always the supervisor's own loopback face, never the ambient
`SPEXCODE_API_URL` this serve itself inherited** (which may carry another project's backend): a worker's
env is its routing lifeline ([[remote-client]]'s ladder), a backend-owned fact rather than an inheritance
gamble. And once the public bind succeeds, the supervisor **publishes its endpoint** — atomically, in
the per-project runtime tier, as an instance-validated record (`{url, pid, instanceId, root}`; the
`instanceId` is minted per serve lifetime, handed to every child via env, and answered live at
`GET /api/instance`) — the record a bare human `spex` in this project's tree discovers its backend by,
and the record the host-level `spex dashboard` ([[host-gateway]]) reconciles its project list from. On a
clean stop it removes only a record still carrying its own `instanceId`. Readers validate before
trusting (a health/identity probe), so a crashed serve leaves only a dead record that is ignored, never
followed.

**Owning the public port is the contract: if I cannot bind it, I have failed.** Keeping-serving is for
*transient* throws once the port is held — never for *failing to acquire* it. So a bind failure (port in
use, or permission denied) is the one throw the supervisor must not swallow: a **hard, loud, non-zero exit**
naming the busy port and the repair, never a portless process kept "alive" on a random child port. The same
rule is **shared** with [[public-mode]]'s gateway behind `spex dashboard`, so a busy port fails identically
on both surfaces — not a silent zombie under `serve` and a crash under `dashboard`. One shared bind helper
both call (not a branch inside the keep-alive guard) reaps the booted child first, so no zombie survives.

**Last-resort resilience:** both supervisor and child install process guards at startup — an unforeseen
async throw (a worktree vanishing mid-read during a worker self-merge, say) is logged and the process
KEEPS SERVING rather than exiting and dropping the public port (and the tmux session) with it.

**Connection reaping — abandoned sockets die server-side.** A backend that never reaps abandoned connections
wedges even while its event loop is idle: a client that times out and kills its request leaks one server-side
socket each time, and enough of them (135 were observed piling on the public port) starve the backend into
*looking* dead while it is actually healthy — the trigger of the mass-restore cascade. Two layers close this,
matched to what each server is. The **child** (and, in public mode, the **gateway**) is a real HTTP server,
and its reaper is the **single owner** of the abandoned-socket deadlines: Node's own overlapping HTTP
timeouts (`headersTimeout`, `keepAliveTimeout`) are DISABLED at reaper install — they cover the same phases
and so are a second mechanism racing the first, and MEASURED (eval `server-reaps-abandoned-connections`,
issue #65) a `headersTimeout: 20000` set beside the reaper won the race at default config on every reap and
silently capped `SPEXCODE_REAP_HEADER_MS` above 20s: the close still looked timely (Node's 408), but the
tunable had silently stopped tuning. No timeout `serverOptions` are passed at the `serve`/`createServer`
sites; `requestTimeout` alone stays at Node's default (~5 min) because it bounds the in-flight request-body
phase the reaper deliberately exempts (a silently-abandoned mid-body upload has no other reaper) and 5 min
shadows no sane deadline. The reaper is an explicit **socket-level deadline** at the
server boundary (`reaper.ts`, one helper installed at every HTTP `createServer`/`serve` site): on socket
birth it is armed with a header deadline it must complete a request within, else it is destroyed; while a
request is in flight the deadline is disarmed (so a slow board build or a streaming response is never cut);
when the response ends the socket re-arms an idle keep-alive deadline. It keys on "no request completed yet /
idle between requests", **never on response duration**, so an *active* WS/SSE stream (the board-stream, the
terminal socket) is exempt for as long as it streams — a WebSocket upgrade is marked exempt for its whole
lifetime. **Which socket carries the deadline is part of the contract**: the deadline must live on the socket
`'request'`/`'upgrade'` actually report, because a deadline the request path cannot reach never disarms and
becomes a kill-timer for *every* connection. On a TLS server (the public gateway) that socket is the
TLSSocket born at `'secureConnection'` — NOT the raw TCP socket `'connection'` delivers; arming the raw
socket there once severed every healthy gateway connection (the actively-pinging board SSE, live terminal
WebSockets) at exactly the header deadline, the dashboard's ~30s "reconnecting…" storm (MEASURED, eval
`stream-survives-public-gateway` on [[graph-stream]]). The raw pre-handshake phase keeps its own header
deadline (a TCP connect that never finishes the TLS handshake is the same slow-loris one layer down), handed
off to the TLSSocket at handshake completion via the connection's addr:port pair — public API only, and a
criterion, not an allowlist: no route- or protocol-specific exemptions, just "deadlines are reachable from
request handling, streams in flight are never duration-reaped". Deadlines are env-tunable
(`SPEXCODE_REAP_HEADER_MS` ≈30s, `SPEXCODE_REAP_IDLE_MS` ≈15s). The
**supervisor** is a raw-TCP proxy, so its equivalent is pairing: a close on *either* half tears down *both* —
the old handler bailed only on `error`, so a clean FIN or a silent client drop left the upstream half-open
forever (the leak). A truly silent abandon that never sends FIN/RST is reaped from the child by its
socket-level deadline, whose close then propagates back through the proxy — so no raw idle timeout is put on
the proxy itself, which would blind it to a legitimately-idle WS/SSE.

Read routes: `/api/graph` (the assembled board — merged tree + per-worktree overlay + session list, the
dashboard's single source, identical to `spex graph --json`) and its push companion `/api/graph/stream`
([[graph-stream]]), an SSE that fires on session-store change so the dashboard reloads on real transitions
instead of a tight poll. `/api/graph` stays a **conditional-request** endpoint: it `ETag`s the body so a
reload that finds nothing changed costs a bodyless `304`, not the whole transfer — a standard HTTP capability,
not a special case (the board is still rebuilt each request; the cost saved is the wire, not the git read). `/api/specs` (live via `loadSpecs`),
`/api/specs/:id/history` + `/api/specs/:id/diff/:hash` (a node's timeline and any version's spec.md
line-diff), `/api/specs/lite` + `/api/specs/:id/content` (filesystem-only body reads the lean board
([[graph-lean]]) offloads: the whole search corpus, and one node's `{body, parts}` on open), `/api/edit`
(a node's in-flight working-tree delta vs its fork point, reviewable from the
board — incl. a **brand-new, still-untracked node** as an all-additions diff, so a just-created uncommitted
node shows its body not nothing), `/api/source` (one **byte window** of a governed source file, gated by the
same policy predicate the coverage walk uses — [[source-read]] owns the contract; the route only resolves the
root, compiles the policy, and maps a refusal onto its status), `/api/settings` (the resolved
[[portable-layout]]), and `/api/plugins` + `/api/slash-commands` (the
`/` dropdown — config-root plugins declaring `surface: command`, plus the Claude-Code command union).
The read-only guidance catalog ([[guidance-catalog]]) is exposed at `/api/guidance` and by the deterministic
`spex guidance` CLI entry point; it carries source references and hashes, never a second copy of plugin/help/guide
prose.

Write/runtime routes are thin callers of the [[sessions]] state machine — no session logic lives here:
`/api/sessions` list + spawn; `/api/sessions/archive-index` is the archived-only lean index (`id`, `title`, `label`,
`closedAt`, `node`) and never substitutes for the id-addressed detail. After the one-time JSON migration marker exists,
ordinary list rows take lifecycle status and parent topology from the canonical session application database and fail
loudly for a governed record with no row; before that explicit cutover fence, the list does not initialize a database as
a read side effect. Per-session `resume`/`interrupt`/`review`/`close`/`quarantine`, plus reads `review` (the merge
bundle), `capture` (the live pane as text), `prompt`, and id-addressed `closure` (the durable terminal-close
audit answer after record removal). `closure` returns only its target id and close time or 404; it is not a
second historical session collection. Every closure response carries its capability marker, including a 404,
so a client can distinguish no close fact from a backend that lacks the route. `merge` is a **dispatch to the session's own
agent**, not a server merge — it returns `{dispatched}` and never touches main's tree. Text input appends a
whole admissible prompt to the target timeline, then best-effort pokes its adapter; a proven-unreachable native
transport paired with a still-live registered worker refuses before that append as stranded, and is also 502.
`rawkey` keeps tmux send-keys for nav; `socket` streams pane bytes. Session
mutations that commit no transition also answer with a non-2xx JSON error, so a refused stop or close cannot
paint as a successful request on the dashboard; the lifecycle guard remains the authority on whether the
destructive action is allowed.
`/api/uploads` writes a pasted file to this (worker) machine's
/tmp and returns its path. At boot the server runs `superviseQueue()` to launch queued sessions and
`superviseTurnFailures()` to reconcile adapter-owned native failure subscriptions; the route layer still
contains no harness protocol branch.
The host ledger is equally thin: `GET /api/resources` returns [[host-resource-budget]]'s latest inventory.
It is read-only; existing lifecycle mutations consult the adapter-owned shared-runtime guard before cleanup.

Issue routes follow the same thin-port rule: `GET /api/issues` returns the merged issue list plus the
writable stores (`local` and configured forge drivers), `GET /api/issues/:id` is the single-thread detail
(the same `findIssue` read behind `spex issue show`; unknown or eval-remark ids 404), and `POST /api/issues`
opens a new issue in the
chosen store. Local writes hit the git-native local store; forge writes call the driver and force a resident
read-back before the dashboard reloads. Evidence bytes ride `/api/evidence` (`POST` = content-addressed put,
`GET /:hash` = ranged streaming read — renamed from `/api/yatsu/blob` in v0.3.0).
