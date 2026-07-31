import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { repoRoot } from '../src/git.js'
import { resolveLauncher, type Launcher } from '../src/harness.js'
import { envSessionId, mainCheckout, sessionStoreDir } from '../src/layout.js'
import { BOOT_GRACE_MS, TMUX_SOCK } from '../src/sessions.js'
import { fileHumanReading } from '../../spec-eval/src/filing.js'
import { parseScenarios } from '../../spec-eval/src/scenarios.js'

// @@@ live-behavior matrix - the parameterized conformance suite behind [[harness-adapter]]'s acceptance
// rule. The eight lifecycle behaviors an adapter must prove are defined ONCE here, harness-agnostically —
// each row = drive steps + evidence collection. The scenario test runs them
// against a REAL dispatched session of any registered launcher, reusing only the public CLI verbs
// (session new/send/show/stop/resume/close, materialize) plus tmux for the kill. A new harness is covered
// by registering its launcher and creating its `<harness>-harness` spec node — zero new runner code.
//
// Scenario declarations live in each harness node's eval.md. The runner only resolves an existing
// declaration and files its reading; it never creates or rewrites contract text.

const SPEX_BIN = fileURLToPath(new URL('../bin/spex.mjs', import.meta.url))

export type RowVerdict = { status: 'pass' | 'fail' | 'skip'; note: string }
export type MatrixRow = {
  key: string            // canonical scenario name
  aliases: string[]      // historical scenario names this test also answers to
  drive: (ctx: MatrixRun) => Promise<RowVerdict>
}

type ExecResult = { code: number; out: string; err: string }

// settled = the worker's turn ended under a truthful state: a declaration (asking/awaiting/parked) or the
// idle demotion. `active` means a turn is (still) running — never a settle.
const SETTLED = new Set(['asking', 'awaiting', 'parked', 'idle'])

const trim = (s: string, n = 1400): string => (s.length > n ? s.slice(0, n) + ` …[+${s.length - n}b]` : s)

// @@@ MatrixRun - the shared run context a row drives through: ONE worker session (launched lazily, closed
// by the close-residue row), logged subprocess helpers over the real CLI, and the per-row transcript slices
// that become each reading's evidence.
export class MatrixRun {
  readonly root = repoRoot()
  readonly launcher: Launcher
  readonly lines: string[] = []
  worker: { id: string; path: string; branch: string | null } | null = null
  lastLaunchAt = 0   // when we last (re)launched the worker's agent — the liveness row waits out the boot grace from here
  private rowStart = 0
  constructor(launcher: Launcher) { this.launcher = launcher }

  log(s: string): void {
    const line = `[${new Date().toISOString().slice(11, 19)}] ${s}`
    this.lines.push(line)
    console.log(line)
  }
  nonce(): string { return randomBytes(3).toString('hex') }

  beginRow(key: string): void { this.rowStart = this.lines.length; this.log(`--- row ${key} ---`) }
  rowTranscript(): string {
    return [`harness-live-matrix ${this.launcher.name} (harness ${this.launcher.harness})`, ...this.lines.slice(this.rowStart)].join('\n')
  }

  exec(cmd: string, args: string[], opts: { cwd?: string; quiet?: boolean } = {}): Promise<ExecResult> {
    return new Promise((resolve) => {
      execFile(cmd, args, { cwd: opts.cwd ?? this.root, maxBuffer: 16 * 1024 * 1024 }, (e, out, err) => {
        const code = e ? (typeof (e as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? (e as unknown as { code: number }).code : 1) : 0
        if (!opts.quiet) {
          this.log(`$ ${cmd === process.execPath ? 'spex' : cmd} ${args.filter((a) => a !== SPEX_BIN).join(' ')} -> exit ${code}`)
          if (out.trim()) this.log(`  stdout: ${trim(out.trim())}`)
          if (err.trim()) this.log(`  stderr: ${trim(err.trim(), 600)}`)
        }
        resolve({ code, out, err })
      })
    })
  }
  spex(args: string[], opts: { cwd?: string; quiet?: boolean } = {}): Promise<ExecResult> {
    return this.exec(process.execPath, [SPEX_BIN, ...args], opts)
  }

  // the board's per-session read — the SAME surface a human manager polls. null = the backend answered
  // "no such session" (or is down); callers treat that per row.
  async show(): Promise<Record<string, any> | null> {
    if (!this.worker) return null
    const r = await this.spex(['session', 'show', this.worker.id, '--json'], { quiet: true })
    if (r.code !== 0) return null
    try { return JSON.parse(r.out) } catch { return null }
  }
  async capture(label: string): Promise<string> {
    if (!this.worker) return ''
    const r = await this.spex(['session', 'show', this.worker.id, '--capture'], { quiet: true })
    this.log(`pane capture (${label}, ${r.code === 0 ? `${r.out.length}b` : 'unavailable'}):\n${trim(r.out.trimEnd(), 2600)}`)
    return r.code === 0 ? r.out : ''
  }

  // poll a predicate over the live board until it holds or the budget expires. The polling itself is part
  // of the measurement: every tick is a real board read, i.e. the normal probe pressure deliver must survive.
  async poll<T>(what: string, seconds: number, fn: () => Promise<T | null | false>): Promise<T | null> {
    const t0 = Date.now()
    let last = ''
    while (Date.now() - t0 < seconds * 1000) {
      const v = await fn()
      if (v) { this.log(`observed: ${what} (after ${Math.round((Date.now() - t0) / 1000)}s)`); return v }
      const s = await this.show()
      const now = s ? `${s.status}/${s.lifecycle}/${s.liveness}` : 'no-record'
      if (now !== last) { this.log(`… waiting for ${what} — status ${now}`); last = now }
      await new Promise((r) => setTimeout(r, 2500))
    }
    this.log(`TIMEOUT (${seconds}s) waiting for ${what}`)
    return null
  }
  settle(seconds: number): Promise<Record<string, any> | null> {
    return this.poll('worker settled', seconds, async () => {
      const s = await this.show()
      return s && s.liveness === 'online' && SETTLED.has(s.lifecycle) ? s : false
    })
  }
  async send(text: string): Promise<number> {
    if (!this.worker) return 1
    return (await this.spex(['session', 'send', this.worker.id, text])).code
  }
  async resume(): Promise<number> {
    if (!this.worker) return 1
    const r = await this.spex(['session', 'resume', this.worker.id])
    this.lastLaunchAt = Date.now()
    return r.code
  }
  // send with a bounded retry: right after a relaunch a harness may honestly read online off its
  // pid-fallback while its control socket is still booting, and deliver fails LOUD in that window (per
  // contract). Retrying is what a human manager does; the deliver-steer row keeps strict single-shot sends
  // because first-shot accept on a settled worker IS its contract.
  async sendRetry(text: string, seconds: number): Promise<boolean> {
    const t0 = Date.now()
    while (true) {
      if ((await this.send(text)) === 0) return true
      if (Date.now() - t0 > seconds * 1000) return false
      this.log('send refused — retrying (the agent may still be rebinding its control socket)')
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
  // wait until the agent is past the launcher's boot grace: inside that window a dead agent legitimately
  // reads `starting` (death is unprovable mid-boot), so a liveness kill must land on an ESTABLISHED agent.
  async waitEstablished(): Promise<void> {
    const wait = this.lastLaunchAt + BOOT_GRACE_MS + 5000 - Date.now()
    if (wait > 0) {
      this.log(`waiting ${Math.ceil(wait / 1000)}s for the boot grace to lapse (kill must land on an established agent)`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }

  // launch the one worker the whole matrix drives. The prompt provokes row 1: a clean answer with an
  // explicit no-declaration instruction, so the FIRST settle is exactly the undeclared stop the gate must catch.
  async launchWorker(): Promise<Record<string, any> | null> {
    const prompt = 'Conformance probe. Reply with exactly one short line containing the single word: ready. '
      + 'Do not use any tool, do not run any command, and do NOT declare any session state (no spex commands). Just answer and stop.'
    const r = await this.spex(['session', 'new', '--launcher', this.launcher.name, '--prompt', prompt])
    if (r.code !== 0) { this.log('launch failed'); return null }
    let created: Record<string, any>
    try { created = JSON.parse(r.out) } catch { this.log('launch printed no JSON'); return null }
    this.worker = { id: created.id, path: created.path, branch: created.branch ?? null }
    this.lastLaunchAt = Date.now()
    this.log(`worker ${created.id} launched (worktree ${created.path}, branch ${created.branch})`)
    return created
  }
  async ensureSettledWorker(): Promise<Record<string, any> | null> {
    if (!this.worker) {
      if (!(await this.launchWorker())) return null
      return this.settle(420)
    }
    const s = await this.show()
    if (s && s.liveness === 'online' && SETTLED.has(s.lifecycle)) return s
    return this.settle(180)
  }

  // every strict descendant of the worker pane's root pid — the harness-agnostic "the agent process", used
  // by the liveness row's kill (the pane and window stay, so only the adapter's own signal can notice).
  async paneDescendants(): Promise<number[]> {
    if (!this.worker) return []
    const pane = await this.exec('tmux', ['-L', TMUX_SOCK, 'list-panes', '-t', this.worker.id, '-F', '#{pane_pid}'], { quiet: true })
    const panePid = Number(pane.out.trim().split('\n')[0])
    if (!panePid) return []
    const ps = await this.exec('ps', ['-eo', 'pid=,ppid='], { quiet: true })
    const kids = new Map<number, number[]>()
    for (const line of ps.out.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)/.exec(line)
      if (!m) continue
      const [pid, ppid] = [Number(m[1]), Number(m[2])]
      const siblings = kids.get(ppid)
      if (siblings) siblings.push(pid)
      else kids.set(ppid, [pid])
    }
    const out: number[] = []
    const stack = [panePid]
    while (stack.length) for (const c of kids.get(stack.pop()!) ?? []) { out.push(c); stack.push(c) }
    this.log(`pane pid ${panePid}, descendants: ${out.join(', ') || '(none)'}`)
    return out
  }
}

// ---------------------------------------------------------------------------------------------------------
// the eight rows. Order matters: they share one worker whose lifecycle they walk end to end — launch/settle
// (1), blocked tool (2), ask (3), deliver+steer (4), resume (5), kill/liveness (6), commit gate (7), close (8).
// ---------------------------------------------------------------------------------------------------------

export const MATRIX: MatrixRow[] = [
  {
    key: 'undeclared-stop',
    aliases: ['stop-gate-bridge', 'undeclared-stop-gate-rejection'],
    drive: async (ctx) => {
      if (ctx.worker) return { status: 'skip', note: 'worker already launched — the first settle is gone' }
      if (!(await ctx.launchWorker())) return { status: 'fail', note: 'session new failed' }
      const s = await ctx.settle(420)
      await ctx.capture('after first settle')
      if (!s) return { status: 'fail', note: 'record stuck active past 420s — the stop-gate rejection never flowed the record out (the pi-harness incident signature)' }
      const taught = existsSync(join(sessionStoreDir(ctx.worker!.id), 'stop-gate-taught'))
      ctx.log(`stop-gate-taught sentinel: ${taught}`)
      if (!taught) return { status: 'skip', note: `worker declared on its own (${s.status}) before ever stopping undeclared — gate unprovoked, re-run to measure` }
      if (!['asking', 'awaiting'].includes(s.lifecycle)) return { status: 'fail', note: `gate taught but the record settled ${s.status}/${s.lifecycle}, not a declared state` }
      return { status: 'pass', note: `undeclared settle gated: teach sentinel planted, record flowed active -> ${s.status} unaided` }
    },
  },
  {
    key: 'pretooluse-block',
    aliases: ['pretooluse-block-live'],
    drive: async (ctx) => {
      if (!(await ctx.ensureSettledWorker())) return { status: 'skip', note: 'no settled worker to drive' }
      const wt = ctx.worker!.path
      const plugRoot = findPluginsRoot(wt)
      if (!plugRoot) return { status: 'skip', note: 'no .plugins root in the worker worktree — nowhere to plant the guard hook' }
      const marker = `MATRIX-BLOCK-${ctx.nonce()}`
      const guardFile = join(wt, 'matrix-guard.txt')
      const guardContent = 'guarded content — the matrix pretooluse row plants and sweeps this file\n'
      const nodeDir = join(plugRoot, 'tmp-matrix-guard')
      try {
        writeFileSync(guardFile, guardContent)
        mkdirSync(nodeDir, { recursive: true })
        writeFileSync(join(nodeDir, 'spec.md'), '---\ntitle: tmp-matrix-guard\nsurface: hook\nstatus: active\nevents:\n- PreToolUse\norder: 5\nblock: true\n---\nTransient guard planted by the harness conformance scenario; swept by the same run.\n')
        const reason = `${marker}: matrix-guard.txt is guarded by the live-behavior matrix run. Do not try another way; report the marker you saw, then run: spex session ask --note 'blocked ${marker}'`
        writeFileSync(join(nodeDir, 'tmp-matrix-guard.sh'), `#!/usr/bin/env bash\npayload=$(cat 2>/dev/null)\ncase "$payload" in\n  *matrix-guard.txt*) printf '%s\\n' ${shellQuote(JSON.stringify({ decision: 'block', reason }))} ;;\nesac\nexit 0\n`)
        const mat = await ctx.spex(['materialize'], { cwd: wt })
        if (mat.code !== 0) return { status: 'skip', note: 'materialize failed in the worker worktree — guard never armed' }
        const sent = await ctx.send("Using any tool, append a line saying TOUCHED to the file matrix-guard.txt in your worktree. If a hook blocks you, do not work around it — note the exact reason marker you saw, then run: spex session ask --note 'blocked: <the marker>' and stop.")
        if (sent !== 0) return { status: 'fail', note: 'instruction send was not accepted' }
        const seen = await ctx.poll('block marker visible + settled', 300, async () => {
          const s = await ctx.show()
          if (!s || !SETTLED.has(s.lifecycle)) return false
          const pane = await ctx.spex(['session', 'show', ctx.worker!.id, '--capture'], { quiet: true })
          return pane.out.includes(marker) || (s.note || '').includes(marker) ? s : false
        })
        await ctx.capture('after guarded touch attempt')
        const content = existsSync(guardFile) ? readFileSync(guardFile, 'utf8') : '(deleted)'
        ctx.log(`guarded file content unchanged: ${content === guardContent}`)
        if (content !== guardContent) return { status: 'fail', note: 'the guarded file CHANGED — the block did not genuinely stop the tool' }
        if (!seen) return { status: 'fail', note: "guarded file untouched but the handler's reason marker never surfaced to the agent" }
        return { status: 'pass', note: `tool call genuinely blocked (file untouched) and the handler's own reason ${marker} reached the agent` }
      } finally {
        rmSync(nodeDir, { recursive: true, force: true })
        rmSync(guardFile, { force: true })
        await ctx.spex(['materialize'], { cwd: wt, quiet: true })
      }
    },
  },
  {
    key: 'ask-note',
    aliases: ['pi-ask-note'],
    drive: async (ctx) => {
      if (!(await ctx.ensureSettledWorker())) return { status: 'skip', note: 'no settled worker to drive' }
      const marker = `MATRIX-ASK-${ctx.nonce()}`
      const sent = await ctx.send(`Run exactly this one command from your worktree, then stop without doing anything else: spex session ask --note '${marker}: matrix probe question'`)
      if (sent !== 0) return { status: 'fail', note: 'instruction send was not accepted' }
      const s = await ctx.poll('record asking with the note marker', 300, async () => {
        const x = await ctx.show()
        return x && x.lifecycle === 'asking' && (x.note || '').includes(marker) ? x : false
      })
      if (!s) return { status: 'fail', note: 'record never read asking with the marker note in the graph' }
      return { status: 'pass', note: `record flipped to asking with the note verbatim (${marker}) in the graph's session entry` }
    },
  },
  {
    key: 'deliver-steer',
    aliases: ['pi-deliver-steer', 'deliver-second-message', 'deliver-mid-turn'],
    drive: async (ctx) => {
      if (!(await ctx.ensureSettledWorker())) return { status: 'skip', note: 'no settled worker to drive' }
      const ack = `ACK-${ctx.nonce()}`
      const steer = `STEER-${ctx.nonce()}`
      const idleCode = await ctx.send(`New task: first print the line ${ack}. Then run this exact shell command and wait for it: for i in $(seq 1 25); do echo tick $i; sleep 1; done. Then stop. Do not repeat the text of this instruction.`)
      if (idleCode !== 0) return { status: 'fail', note: 'idle send was not accepted (exit != 0)' }
      const working = await ctx.poll('turn in flight (status working)', 150, async () => {
        const s = await ctx.show()
        return s && s.status === 'working' ? s : false
      })
      if (!working) return { status: 'skip', note: 'never observed the turn in flight — no mid-turn window to measure steer in' }
      const steerCode = await ctx.send(`Change of plan: stop the counting task as soon as you can, print the line ${steer}, and stop.`)
      const settled = await ctx.settle(360)
      const pane = await ctx.capture('after steer settle')
      const ackCount = (pane.match(new RegExp(ack, 'g')) || []).length
      const steered = pane.includes(steer)
      ctx.log(`idle-send exit ${idleCode}; steer-send exit ${steerCode}; ack marker x${ackCount} in pane; steer marker present: ${steered}`)
      if (steerCode !== 0) return { status: 'fail', note: 'mid-turn send was not accepted (exit != 0)' }
      if (!settled) return { status: 'fail', note: 'worker never settled after the steer' }
      if (!steered) return { status: 'fail', note: 'steer marker never appeared — the mid-turn send was dropped' }
      if (ackCount > 3) return { status: 'fail', note: `ack marker appeared ${ackCount}x — duplicate injection signature` }
      return { status: 'pass', note: `idle send landed once (exit 0, marker x${ackCount} incl. the injected render + echo), mid-turn send steered the live turn (${steer} in the same turn)` }
    },
  },
  {
    key: 'resume',
    aliases: ['pi-resume', 'resume-continuity'],
    drive: async (ctx) => {
      if (!(await ctx.ensureSettledWorker())) return { status: 'skip', note: 'no settled worker to drive' }
      const token = `TK${ctx.nonce()}`
      if ((await ctx.send(`Remember this token: ${token}. Reply ok, then stop.`)) !== 0) return { status: 'fail', note: 'seed send was not accepted' }
      if (!(await ctx.settle(300))) return { status: 'fail', note: 'worker never settled after the seed' }
      await ctx.spex(['session', 'stop', ctx.worker!.id])
      const off = await ctx.poll('offline after stop', 60, async () => {
        const s = await ctx.show()
        return s && s.liveness === 'offline' ? s : false
      })
      if (!off) return { status: 'fail', note: 'session never read offline after spex session stop' }
      if ((await ctx.resume()) !== 0) return { status: 'fail', note: 'spex session resume failed' }
      const on = await ctx.poll('online after resume', 240, async () => {
        const s = await ctx.show()
        return s && s.liveness === 'online' ? s : false
      })
      if (!on) return { status: 'fail', note: 'session never read online after resume' }
      if (!(await ctx.sendRetry('Earlier in this conversation I gave you a token starting with TK. Reply with one line in the exact format RECALL=<that token>, then stop.', 90))) return { status: 'fail', note: 'recall send never accepted within 90s of the relaunch — the resumed agent is not reachable' }
      await ctx.settle(300)
      const pane = await ctx.capture('after recall')
      if (!pane.includes(`RECALL=${token}`)) return { status: 'fail', note: `resumed agent could not produce RECALL=${token} — not the same conversation` }
      return { status: 'pass', note: `stop -> resume continued the SAME conversation (agent recalled ${token} across the relaunch)` }
    },
  },
  {
    key: 'liveness',
    aliases: ['pi-liveness', 'liveness-signals'],
    drive: async (ctx) => {
      if (!(await ctx.ensureSettledWorker())) return { status: 'skip', note: 'no settled worker to drive' }
      await ctx.waitEstablished()
      const pids = await ctx.paneDescendants()
      if (!pids.length) return { status: 'skip', note: 'no agent processes found under the pane to kill' }
      for (const pid of pids) { try { process.kill(pid, 'SIGKILL') } catch { /* raced its own death */ } }
      const t0 = Date.now()
      ctx.log(`SIGKILLed ${pids.length} pane descendants`)
      const off = await ctx.poll('offline after kill', 60, async () => {
        const s = await ctx.show()
        return s && s.liveness === 'offline' ? s : false
      })
      const dt = Math.round((Date.now() - t0) / 1000)
      if (!off) return { status: 'fail', note: 'killed agent never read offline — a stale socket/pid still reads as alive' }
      if ((await ctx.resume()) !== 0) return { status: 'fail', note: `offline in ${dt}s, but resume failed` }
      const on = await ctx.poll('online after relaunch', 240, async () => {
        const s = await ctx.show()
        return s && s.liveness === 'online' ? s : false
      })
      if (!on) return { status: 'fail', note: `offline in ${dt}s, but the relaunch never read online` }
      if (dt > 15) return { status: 'fail', note: `offline took ${dt}s — the dead agent read alive far beyond the honest window` }
      return { status: 'pass', note: `killed agent read offline in ${dt}s (pane + stale socket file still on disk); relaunch reads online` }
    },
  },
  {
    key: 'commit-gate',
    aliases: ['pi-commit-gate', 'commit-gate-rejection'],
    drive: async (ctx) => {
      if (!(await ctx.ensureSettledWorker())) return { status: 'skip', note: 'no settled worker to drive' }
      const wt = ctx.worker!.path
      writeFileSync(join(wt, 'matrix-scratch.txt'), 'scratch\n')
      const isDirty = async () => (await ctx.exec('git', ['-C', wt, 'status', '--porcelain'], { quiet: true })).out.trim() !== ''
      if (!(await ctx.sendRetry('This conformance run deliberately planted an uncommitted file (matrix-scratch.txt) in your worktree to test the commit gate. Do not commit or remove anything yourself yet. Run exactly: spex session done --propose merge — then stop. If the gate rejects you, follow whatever it says.', 90))) return { status: 'fail', note: 'instruction send never accepted within 90s — the worker is not reachable' }
      // classify what the gate did. The record reads `review` the moment the CLI writes the proposal —
      // BEFORE the stop-gate has run at the agent's stop — so a transient review+dirty is the normal
      // mid-loop state, and only a STABLE dirty review (the gate's stop verdict and its forced-continuation
      // escape both missed) is the gate failing. A settle with the tree still dirty and no review is the
      // gate holding; a clean review after the rejection text surfaced is the agent obeying the gate's own
      // teaching (rejection PROVEN either way).
      let rejectionSeen = false
      let dirtyReviewSince = 0
      let outcome: 'dirty-review' | 'held' | 'self-repaired' | null = null
      await ctx.poll('commit-gate outcome', 420, async () => {
        const s = await ctx.show()
        if (!s) return false
        const dirty = await isDirty()
        if (!rejectionSeen) {
          const pane = await ctx.spex(['session', 'show', ctx.worker!.id, '--capture'], { quiet: true })
          if (/uncommitted (changes|work)/.test(pane.out + (s.note || ''))) { rejectionSeen = true; ctx.log('gate rejection text surfaced in the session') }
        }
        if (s.status === 'review' && dirty) {
          dirtyReviewSince ||= Date.now()
          if (Date.now() - dirtyReviewSince > 90_000) { outcome = 'dirty-review'; return true }
          return false
        }
        dirtyReviewSince = 0
        if (s.status === 'review' && !dirty && rejectionSeen) { outcome = 'self-repaired'; return true }
        if (SETTLED.has(s.lifecycle) && s.status !== 'review' && dirty && rejectionSeen) { outcome = 'held'; return true }
        return false
      })
      await ctx.capture('after dirty proposal')
      if (outcome === 'dirty-review') return { status: 'fail', note: 'a DIRTY merge proposal stands as review — the commit gate let a dishonest proposal through' }
      if (!outcome) {
        return rejectionSeen
          ? { status: 'fail', note: 'gate rejection surfaced but the session reached no classifiable settle in time' }
          : { status: 'skip', note: 'the dirty-proposal rejection was never observed (worker may have committed first) — re-run to measure' }
      }
      if (outcome === 'held') {
        // the agent obeyed the rejection and is waiting — drive the honest completion explicitly.
        if ((await ctx.send("Now commit the work: run git add -A && git commit -m 'matrix: scratch probe', then run exactly: spex session done --propose merge — and then stop.")) !== 0) return { status: 'fail', note: 'commit instruction send was not accepted' }
        const b = await ctx.poll('clean proposal accepted (review)', 360, async () => {
          const s = await ctx.show()
          return s && s.status === 'review' && !(await isDirty()) ? s : false
        })
        if (!b) return { status: 'fail', note: 'dirty proposal correctly rejected, but the clean re-proposal never reached review' }
      }
      const msg = (await ctx.exec('git', ['-C', wt, 'log', '-1', '--format=%B'], { quiet: true })).out
      ctx.log(`worker HEAD commit message:\n${trim(msg.trim(), 500)}`)
      if (!/^Session: /m.test(msg)) return { status: 'fail', note: 'clean proposal accepted but the commit carries no Session: trailer — attribution lost' }
      return { status: 'pass', note: `dirty proposal rejected (reason delivered in-session), committed re-proposal accepted as review${outcome === 'self-repaired' ? ' (agent self-repaired per the gate\'s teaching)' : ''}, commit auto-stamped with the Session trailer` }
    },
  },
  {
    key: 'close-residue',
    aliases: ['pi-close-residue'],
    drive: async (ctx) => {
      if (!ctx.worker) return { status: 'skip', note: 'no worker to close' }
      const { id, path: wt, branch } = ctx.worker
      const store = sessionStoreDir(id)
      const r = await ctx.spex(['session', 'close', id])
      if (r.code !== 0) return { status: 'fail', note: 'spex session close failed' }
      const gone = await ctx.poll('zero residue', 120, async () => {
        const tmuxAlive = (await ctx.exec('tmux', ['-L', TMUX_SOCK, 'has-session', '-t', id], { quiet: true })).code === 0
        const procs = (await ctx.exec('ps', ['-eo', 'args='], { quiet: true })).out.split('\n').filter((l) => l.includes(wt))
        const branchLeft = branch ? (await ctx.exec('git', ['-C', mainCheckout(), 'branch', '--list', branch], { quiet: true })).out.trim() : ''
        const left = [
          tmuxAlive && 'tmux window', existsSync(wt) && 'worktree dir', branchLeft && `branch ${branch}`,
          existsSync(store) && 'session store dir', procs.length && `${procs.length} process(es): ${trim(procs.join(' | '), 300)}`,
        ].filter(Boolean)
        if (left.length) { ctx.log(`residue still present: ${left.join(', ')}`); return false }
        return true
      })
      ctx.worker = null
      if (!gone) return { status: 'fail', note: 'residue survived close past 120s (see transcript for what remained)' }
      return { status: 'pass', note: 'close swept everything: tmux window, process tree, worktree + branch, session record/store dir' }
    },
  },
]

// single-quote a string for safe embedding in the generated guard script
function shellQuote(s: string): string { return `'${s.replace(/'/g, `'\\''`)}'` }

// the worktree's plugin root (`.plugins` dir holding a spec.md), found by walking .spec — where the
// pretooluse row plants its transient guard node.
function findPluginsRoot(wt: string): string | null {
  const specDir = join(wt, '.spec')
  const stack = existsSync(specDir) ? [specDir] : []
  while (stack.length) {
    const dir = stack.pop()!
    let ents
    try { ents = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of ents) {
      if (!e.isDirectory()) continue
      const p = join(dir, e.name)
      if (e.name === '.plugins' && existsSync(join(p, 'spec.md'))) return p
      stack.push(p)
    }
  }
  return null
}

// ---------------------------------------------------------------------------------------------------------
// scenario lookup — the harness node owns the contract text; this test only selects declared cases.
// ---------------------------------------------------------------------------------------------------------

// The test target is resolved from the registered launcher, while its scenario declarations remain owned by
// the harness node's eval.md. Missing declarations fail loudly instead of being generated by the test.
function findNodeDir(root: string, id: string): string | null {
  const specDir = join(root, '.spec')
  const hits: string[] = []
  const stack = existsSync(specDir) ? [specDir] : []
  while (stack.length) {
    const dir = stack.pop()!
    let ents
    try { ents = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of ents) {
      if (!e.isDirectory()) continue
      const p = join(dir, e.name)
      if (e.name === id && existsSync(join(p, 'spec.md'))) hits.push(p)
      stack.push(p)
    }
  }
  if (hits.length > 1) throw new Error(`node id '${id}' is ambiguous (${hits.length} dirs) — pass --node with a unique id`)
  return hits[0] ?? null
}

const VALUE_FLAGS = ['--node', '--rows']

function scenarioNames(nodeDir: string, harnessId: string, row: MatrixRow): string[] {
  const evalPath = join(nodeDir, 'eval.md')
  if (!existsSync(evalPath)) throw new Error(`${evalPath} is missing — declare the scenario before running its test`)
  const scenarios = parseScenarios(readFileSync(evalPath, 'utf8'))
  return scenarios
    .filter((scenario) => scenario.name === row.key || scenario.name === `${harnessId}-${row.key}` || row.aliases.includes(scenario.name))
    .map((scenario) => scenario.name)
}

export async function runHarnessMatrix(args: string[]): Promise<number> {
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? args[i + 1] : undefined
  }
  // the launcher is the first bare positional — scanned left to right, skipping each value flag's value
  // (so `--rows liveness pi` reads `pi`, never `liveness`).
  let launcherName: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.includes(args[i])) { i++; continue }
    if (args[i].startsWith('--')) continue
    launcherName = args[i]
    break
  }
  if (!launcherName) {
    console.error('usage: npx tsx spec-cli/scenarios/harness-live-matrix.ts <launcher> [--node <id>] [--rows key1,key2]\n  runs declared harness scenarios against a REAL dispatched session and files readings (rows: ' + MATRIX.map((r) => r.key).join(', ') + ')')
    return 2
  }
  let launcher: Launcher
  try { launcher = resolveLauncher(launcherName) } catch (e) { console.error(`harness-live-matrix: ${(e as Error).message}`); return 2 }
  const root = repoRoot()
  const nodeId = flag('node') ?? `${launcher.harness}-harness`
  const nodeDir = findNodeDir(root, nodeId)
  if (!nodeDir) {
    console.error(`harness-live-matrix: no spec node '${nodeId}' in this tree — create its spec and eval scenarios first, or pass --node <id>`)
    return 2
  }
  const rowKeys = flag('rows')?.split(',').map((s) => s.trim()).filter(Boolean)
  const rows = rowKeys ? MATRIX.filter((r) => rowKeys.includes(r.key)) : MATRIX
  if (rowKeys && rows.length !== rowKeys.length) {
    console.error(`harness-live-matrix: unknown row(s) ${rowKeys.filter((k) => !MATRIX.some((r) => r.key === k)).join(', ')} — rows: ${MATRIX.map((r) => r.key).join(', ')}`)
    return 2
  }
  const by = envSessionId() ?? undefined
  const ctx = new MatrixRun(launcher)
  const results: { row: MatrixRow; verdict: RowVerdict; filedAs: string[] }[] = []
  for (const row of rows) {
    ctx.beginRow(row.key)
    let verdict: RowVerdict
    try { verdict = await row.drive(ctx) } catch (e) {
      verdict = { status: 'fail', note: `runner error: ${(e as Error).message}` }
      ctx.log(verdict.note)
    }
    ctx.log(`row ${row.key}: ${verdict.status.toUpperCase()} — ${verdict.note}`)
    const filedAs: string[] = []
    if (verdict.status !== 'skip') {
      const names = scenarioNames(nodeDir, launcher.harness, row)
      if (!names.length) {
        ctx.log(`row ${row.key}: no matching scenario declaration in ${nodeId}/eval.md`)
        results.push({ row, verdict: { status: 'fail', note: `scenario '${row.key}' is not declared in ${nodeId}/eval.md` }, filedAs })
        continue
      }
      for (const name of names) {
        const filed = fileHumanReading(nodeId, { scenario: name, status: verdict.status, note: verdict.note, transcript: ctx.rowTranscript(), ...(by ? { by } : {}) })
        if (!filed.ok) ctx.log(`filing to scenario '${name}' failed: ${'error' in filed ? filed.error : 'unknown filing failure'}`)
        else filedAs.push(name)
      }
    }
    results.push({ row, verdict, filedAs })
  }
  console.log('\n=== live-behavior matrix ===')
  console.log(`launcher ${launcher.name} (harness ${launcher.harness}) -> node ${nodeId}`)
  for (const r of results) {
    console.log(`  ${r.verdict.status.toUpperCase().padEnd(4)} ${r.row.key.padEnd(17)} ${r.verdict.note}${r.filedAs.length ? `  [filed: ${r.filedAs.join(', ')}]` : '  [not filed]'}`)
  }
  if (ctx.worker) console.log(`note: worker ${ctx.worker.id} left open for inspection (close-residue did not run/pass) — spex session close ${ctx.worker.id}`)
  return results.every((r) => r.verdict.status === 'pass') ? 0 : 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runHarnessMatrix(process.argv.slice(2)).then((code) => { process.exitCode = code }).catch((error) => {
    console.error(`harness-live-matrix: ${error.stack || error}`)
    process.exitCode = 2
  })
}
