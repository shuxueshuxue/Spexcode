// @@@ shim-runtime - the ONE shared runtime every GENERATIVE per-session shim embeds ([[shim-runtime]]).
// pi's extension and opencode's plugin (and any future in-process harness shim) are thin hosts: they declare
// an event-name mapping and bind their host's API; the machinery they share — claude-shaped payload synthesis
// into dispatch.sh, the block-verdict parse, the rendezvous socket server, tool-input normalization — is THIS
// module's generated chunk, embedded verbatim by each generator. One source of truth: the deliver-confirm and
// stop-gate-rejection bugs were each fixed in only one of the two hand-written copies this replaces; a fix
// here reaches every generative shim at the next materialize.
//
// The chunk is PLAIN JavaScript (no type annotations, no non-builtin imports): pi loads its shim as a native
// .ts extension, opencode as a project plugin, and tests import the generated file directly under node — the
// lowest common denominator is untyped ESM against node builtins. Identifiers are __spex-prefixed so a host
// section can never collide with them.

// the embedded runtime chunk. `harnessId` is baked as dispatch.sh's argv[1] (the deterministic shell-side
// harness detector); `dispatch`/`spex` are the absolute paths materialize bakes into every shim — the
// 'dispatch.sh' substring doubles as the identity stamp cleanHarness gates removal on.
export function shimRuntimeSource(harnessId: string, dispatch: string, spex: string): string {
  return `// ---- spexcode shared shim runtime (embedded from spec-cli/src/shim-runtime.ts — edit THERE) ----
import { spawn as __spexSpawn } from "node:child_process"
import { createServer as __spexCreateServer } from "node:net"
import { unlinkSync as __spexUnlink } from "node:fs"

const DISPATCH = ${JSON.stringify(dispatch)}
const SPEX = ${JSON.stringify(spex)}
const HARNESS = ${JSON.stringify(harnessId)}

// cfg: { sessionId: () => string, cwd?: () => string } — the two identity accessors a host binds; everything
// else is shared machinery.
const spexShimRuntime = (cfg) => {
  const cwd = cfg.cwd || (() => process.cwd())

  // feed ONE claude-shaped payload ({ session_id, cwd, hook_event_name, ...extra }) to dispatch.sh, the
  // harness id baked as argv[1]. Payload key order matters for tool events: a host must put agent_id (when
  // present) BEFORE tool_input so harness.sh's hp_is_subagent prefix scan can see it. Resolves with the exit
  // code + both streams for the verdict helpers below; never rejects.
  const dispatchEvent = (event, extra) => new Promise((resolve) => {
    let out = "", err = ""
    let child
    try {
      child = __spexSpawn("bash", [DISPATCH, HARNESS, event], {
        cwd: cwd(), env: { ...process.env, SPEX }, stdio: ["pipe", "pipe", "pipe"], timeout: 600_000,
      })
    } catch (e) { resolve({ code: 1, out, err: String(e) }); return }
    child.stdout.on("data", (d) => { out += d })
    child.stderr.on("data", (d) => { err += d })
    child.on("error", (e) => resolve({ code: 1, out, err: err || String(e) }))
    child.on("close", (code) => resolve({ code: code == null ? 1 : code, out, err }))
    // a handler may exit without draining stdin (fast-fail scripts, a missing dispatch file) — the write then
    // EPIPEs; that must never throw into the host's event handler, the child's exit code still answers.
    child.stdin.on("error", () => { /* child exited before reading — fine */ })
    try { child.stdin.end(JSON.stringify({ session_id: cfg.sessionId(), cwd: cwd(), hook_event_name: event, ...(extra || {}) })) } catch { /* same */ }
  })

  // the ONE block contract: dispatch.sh signals a block by EXIT 2 (a handler's stdout
  // {"decision":"block","reason":…} JSON is mapped to exit 2 by dispatch itself, stderr staying empty; a
  // bare exit-2 handler writes its reason on stderr instead). codex's stderr bridge is codex's own native
  // protocol and lives in dispatch.sh — not here.
  const blocked = (r) => r.code === 2

  // the human-readable rejection, extracted in contract order — never the raw wire JSON (an escaped-\\n blob
  // turned the stop-gate's teaching menu into one unreadable line on one harness before this was shared):
  //   1. a decision:block JSON line on stdout, strictly parsed (the designed channel);
  //   2. several handlers' stdout objects can arrive GLUED without separators — regex the reason string out
  //      (JSON.parse of the string literal unescapes it);
  //   3. stderr — the channel a bare exit-2 handler writes;
  //   4. the caller's fallback.
  const blockReason = (r, fallback) => {
    for (const line of (r.out || "").split("\\n")) {
      const s = line.trim()
      if (!s.startsWith("{")) continue
      try {
        const o = JSON.parse(s)
        if (o && o.decision === "block" && typeof o.reason === "string" && o.reason) return o.reason
      } catch { /* not a lone JSON line — the glued fallback below */ }
    }
    if (/"decision"\\s*:\\s*"block"/.test(r.out || "")) {
      const m = (r.out || "").match(/"reason"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"/)
      if (m) { try { return JSON.parse('"' + m[1] + '"') } catch { /* malformed escape — fall through */ } }
    }
    return (r.err || "").trim() || fallback
  }

  // the Stop dispatch with the gate's LOOP-TERMINATION bit. Claude's native Stop payload carries
  // stop_hook_active=true when the stop happens inside a continuation a Stop-hook block itself forced, and
  // the stop-gate's escape paths key on exactly that bit to guarantee the loop ends (auto-declare /
  // downgrade-to-ask instead of a fresh block). A generative host has no native bit, so the runtime supplies
  // it: false on a natural stop, true on the settle that follows a blocked one, reset by the first allowed
  // stop. Without it every settle reads as a FIRST stop and a gate that can never pass (e.g. the commit gate
  // on a 0-commit worktree) blocks forever — the measured one-shot wedge: the host disposes its session
  // while the loop still runs, the next inject throws into the host ("extension ctx is stale"), the
  // rejection is dropped, and the record wedges undeclared. On block, the host's inject re-enters the
  // gate's reason as the continuation; an inject that cannot land any more (the disposed one-shot host) is
  // caught LOUD on stderr — never thrown into the host, never silent — and the out-of-process one-shot
  // recovery ([[harness-adapter]]) is the layer that survives the process. stopPending exposes whether the
  // last Stop verdict was a block still awaiting its continuation's allow — the state a host's backstop
  // binding (pi's agent_settled) keys on to consume exactly one pending blocked stop, never duplicating a
  // naturally-allowed dispatch.
  let stopBlocked = false
  const stopPending = () => stopBlocked
  const dispatchStop = async (inject, fallback) => {
    const r = await dispatchEvent("Stop", { stop_hook_active: stopBlocked })
    if (blocked(r)) {
      stopBlocked = true
      try { await inject(blockReason(r, fallback)) } catch (e) {
        console.error("spexcode: a blocked stop's continuation could not be re-injected (host session already disposed — one-shot exit?): " + String(e))
      }
    } else stopBlocked = false
    return r
  }

  // normalize a host tool-input onto the claude accessor shape: mirror the host's file-path spelling onto
  // file_path (the key harness.sh and every claude-family handler read), dropping the host spelling.
  const toolInput = (input, fileAlias) => {
    const args = { ...(input && typeof input === "object" ? input : {}) }
    if (fileAlias && args[fileAlias] !== undefined && args.file_path === undefined) {
      args.file_path = args[fileAlias]
      delete args[fileAlias]
    }
    return args
  }

  // the per-session rendezvous control socket: bind a line-JSON server on CLAUDE_BG_RENDEZVOUS_SOCK (handed
  // by every ownsRendezvous launch; a self-launched bare harness has no env → no server) speaking the
  // reclaude mini-protocol, so claude's deliverViaRendezvous and socket-listener liveness work UNCHANGED.
  // MULTI-connection (unlike reclaude's daemon): a board liveness probe connect can never kick a concurrent
  // delivery, so the sender's atomic reply+repaint chunk always resolves on its own connection. The data
  // handler is deliberately SYNCHRONOUS — a chunk's lines parse in one pass and repaint-done (the in-order
  // parse barrier) flushes before any other event can run: confirmation means PARSED, not processed; the
  // injection (a whole model turn on some hosts) runs BEHIND the confirm. A known-unable inject answers
  // reply-rejected BEFORE repaint-done so the sender fails loud instead of confirming a prompt that can
  // never land; a LATE inject failure best-effort reply-rejects (the sender has usually resolved and gone).
  const serveRendezvous = (inject, opts) => {
    const sock = (process.env.CLAUDE_BG_RENDEZVOUS_SOCK || "").trim()
    if (!sock) return null
    try { __spexUnlink(sock) } catch { /* no stale socket — fine */ }
    const reject = (c) => { try { c.write(JSON.stringify({ type: "reply-rejected" }) + "\\n") } catch { /* peer gone */ } }
    const server = __spexCreateServer((c) => {
      let buf = ""
      c.on("error", () => { /* probes disconnect abruptly — expected */ })
      c.on("data", (d) => {
        buf += d.toString("utf8")
        let nl
        while ((nl = buf.indexOf("\\n")) >= 0) {
          const line = buf.slice(0, nl)
          buf = buf.slice(nl + 1)
          let msg
          try { msg = JSON.parse(line) } catch { continue }
          if (msg && msg.type === "reply" && typeof msg.text === "string") {
            if (opts && opts.canInject && !opts.canInject()) { reject(c); continue }
            try {
              const p = inject(msg.text)
              if (p && typeof p.catch === "function") p.catch(() => reject(c))
            } catch { reject(c) }
          } else if (msg && msg.type === "repaint") {
            try { c.write(JSON.stringify({ type: "repaint-done" }) + "\\n") } catch { /* peer gone */ }
          }
        }
      })
    })
    server.on("error", (e) => console.error("spexcode: rendezvous socket failed to bind at " + sock + ": " + String(e)))
    server.listen(sock)
    server.unref()   // never hold the host process open for our socket; the harness's own loop keeps it alive
    return { close: () => {
      try { server.close() } catch { /* already closed */ }
      try { __spexUnlink(sock) } catch { /* already gone */ }
    } }
  }

  return { dispatchEvent, dispatchStop, stopPending, blocked, blockReason, toolInput, serveRendezvous }
}
// ---- end spexcode shared shim runtime ----`
}
