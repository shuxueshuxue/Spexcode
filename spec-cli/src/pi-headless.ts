import { createServer, type Server, type Socket } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DispatchResult, HarnessDeliveryRecord } from './harness.js'
import { controlRequest, withTimeout } from './headless-controller.js'
import { shQuote } from './sh.js'

type ControlRequest = { type: 'deliver'; text: string; mid?: string } | { type: 'interrupt' }
type ChildTurn = { process: ChildProcess; exited: Promise<number | null> }

const PKG = fileURLToPath(new URL('..', import.meta.url))
const SPEX = join(PKG, 'bin', 'spex.mjs')
const CONTROL_TIMEOUT_MS = 30_000
const START_TIMEOUT_MS = 30_000
const TERM_EXIT_GRACE_MS = 500
const KILL_EXIT_GRACE_MS = 2_000
const INTERRUPT_EXIT_GRACE_MS = 15_000

/** The resident controller socket is distinct from pi's per-turn rendezvous socket. */
export const piHeadlessSock = (id: string) => join(tmpdir(), `spexcode-ph-${id}.sock`)

export function piHeadlessLaunchCommand(id: string, runtimeDir: string, piCmd: string): string {
  return [shQuote(SPEX), 'internal', 'pi-headless-run', shQuote(id), shQuote(runtimeDir), shQuote(piCmd), '--'].join(' ')
}

export const deliverViaPiHeadless = (rec: HarnessDeliveryRecord, text: string) =>
  controlRequest(piHeadlessSock(rec.session), { type: 'deliver', text, mid: rec.mid }, {
    name: 'pi-headless', session: rec.session, timeoutMs: CONTROL_TIMEOUT_MS,
    rejected: 'pi-headless controller rejected the request',
  })

// The controller owns the turn child, so it is the one actor that can both abort the turn natively and
// know when that turn is actually over — an interrupt confirmed here means no pi process serves this
// session any more, and the next delivery is a clean cold wake rather than a poke into an exiting agent.
export const interruptPiHeadless = (rec: HarnessDeliveryRecord) =>
  controlRequest(piHeadlessSock(rec.session), { type: 'interrupt' }, {
    name: 'pi-headless', session: rec.session, timeoutMs: CONTROL_TIMEOUT_MS,
    rejected: 'pi-headless controller rejected the interrupt',
  })

// The resident controller and a running pi turn own two per-session listeners. The generic lifecycle
// teardown has already proved and removed the exact controller leaf before this runs; cold filing is valid
// only once neither listener can still accept work for this session.
export async function piHeadlessColdRuntime(rec: Pick<HarnessDeliveryRecord, 'session'>): Promise<DispatchResult> {
  const { listenerAt, rvSock } = await import('./harness.js')
  const paths = [piHeadlessSock(rec.session), rvSock(rec.session)]
  const probes = await Promise.all(paths.map((path) => listenerAt(path)))
  const pending = paths.filter((_, index) => probes[index] !== 'dead')
  return pending.length
    ? { ok: false, error: `pi-headless runtime is still ${probes.some((probe) => probe === 'live') ? 'live' : 'unproven'} (${pending.join(', ')})` }
    : { ok: true }
}

export class PiHeadlessController {
  private server: Server | null = null
  private child: ChildTurn | null = null
  private controlQueue: Promise<void> = Promise.resolve()
  private closing = false
  private readonly socketPath: string

  constructor(
    private readonly id: string,
    _runtimeDir: string,
    private readonly piCmd: string,
    private readonly cwd = process.cwd(),
  ) {
    this.socketPath = piHeadlessSock(id)
  }

  async start(initialPrompt?: string): Promise<void> {
    try { rmSync(this.socketPath, { force: true }) } catch { /* stale control socket is replaced at startup */ }
    this.server = createServer((socket) => this.accept(socket))
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { this.server?.off('listening', onListening); reject(error) }
      const onListening = () => { this.server?.off('error', onError); resolve() }
      this.server!.once('error', onError)
      this.server!.once('listening', onListening)
      this.server!.listen(this.socketPath)
    })
    if (initialPrompt) void this.spawnTurn(initialPrompt, false).catch((error) => {
      console.error(`[spex pi-headless] initial turn failed: ${(error as Error).message}`)
    })
  }

  async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    const child = this.child
    try {
      if (child) await this.terminateTurn(child)
    } finally {
      await new Promise<void>((resolve) => {
        if (!this.server) return resolve()
        this.server.close(() => resolve())
      })
      // same proof-before-removal rule as every other teardown (harness.ts unlinkSocks): a socket path is keyed
      // by session id alone, so only a listener PROVEN dead is ours to unlink.
      const { rvSock, unlinkSocks } = await import('./harness.js')
      await unlinkSocks(this.socketPath, rvSock(this.id))
    }
  }

  private async terminateTurn(turn: ChildTurn): Promise<void> {
    if (turn.process.exitCode !== null) return
    try { turn.process.kill('SIGTERM') } catch { /* the child can leave between the exit check and signal */ }
    if (await this.waitForExit(turn, TERM_EXIT_GRACE_MS)) return
    try { turn.process.kill('SIGKILL') } catch { /* already gone */ }
    await withTimeout(turn.exited, KILL_EXIT_GRACE_MS, `pi-headless turn did not exit for session ${this.id}`)
  }

  private async waitForExit(turn: ChildTurn, timeoutMs: number): Promise<boolean> {
    try {
      await withTimeout(turn.exited, timeoutMs, 'turn exit grace elapsed')
      return true
    } catch { return false }
  }

  private accept(socket: Socket): void {
    socket.setEncoding('utf8')
    let buffer = ''
    let handled = false
    socket.on('data', (chunk) => {
      if (handled) return
      buffer += chunk
      const nl = buffer.indexOf('\n')
      if (nl < 0) return
      handled = true
      let request: ControlRequest
      try { request = JSON.parse(buffer.slice(0, nl)) as ControlRequest } catch (error) {
        socket.end(`${JSON.stringify({ ok: false, error: `invalid control request: ${(error as Error).message}` })}\n`)
        return
      }
      this.controlQueue = this.controlQueue.then(async () => {
        const result = await this.handle(request).catch((error) => ({ ok: false, error: (error as Error).message }))
        socket.end(`${JSON.stringify(result)}\n`)
      })
    })
  }

  // Abort the running turn through pi's own ctx.abort() (the shim answers over the child's rendezvous socket,
  // so pi records the turn as aborted and the conversation stays resumable), then wait for that child to
  // exit. A turn whose extension holds no context yet — pi still booting, before its first agent event —
  // is still THIS controller's process, so it is terminated as the owner rather than left to run.
  private async interrupt(): Promise<DispatchResult> {
    const turn = this.child
    if (!turn || turn.process.exitCode !== null) return { ok: false, error: `no pi-headless turn is running for session ${this.id} - nothing to interrupt` }
    const { interruptViaRendezvous } = await import('./harness.js')
    const aborted = await interruptViaRendezvous(this.id, 'pi-headless')
    if (!aborted.ok && !/no pi turn is running|nothing to interrupt/.test(aborted.error || '')) return aborted
    if (!aborted.ok || !await this.waitForExit(turn, INTERRUPT_EXIT_GRACE_MS)) await this.terminateTurn(turn)
    return { ok: true }
  }

  private async handle(request: ControlRequest): Promise<DispatchResult> {
    if (request.type === 'interrupt') return this.interrupt()
    if (request.type !== 'deliver') return { ok: false, error: 'unknown pi-headless control request' }
    if (!request.text) return { ok: false, error: 'empty prompt - nothing to deliver' }

    // A live extension listener is an in-flight pi turn. Only a proven absent listener may cold-wake a saved
    // session; an inconclusive probe must not start a duplicate turn.
    const { deliverViaSocketOrWake } = await import('./harness.js')
    return deliverViaSocketOrWake(this.id, request.text, request.mid, async () => {
      if (this.child) await withTimeout(this.child.exited, 5_000, `previous pi-headless turn did not exit for session ${this.id}`)
      await this.spawnTurn(request.text, true)
      return { ok: true }
    }, `could not determine whether pi turn ${this.id} is live — prompt NOT delivered`)
  }

  private async spawnTurn(text: string, resume: boolean): Promise<void> {
    if (this.closing) throw new Error('pi-headless controller is closing')
    const mode = resume ? ['--session', this.id] : ['--session-id', this.id]
    // Keep pi's default text mode. `--mode json` is intentionally omitted: it can hang in this runtime.
    const args = ['-p', ...mode, text]
    const command = `exec ${this.piCmd} ${args.map(shQuote).join(' ')}`
    const childProcess = spawn('/bin/sh', ['-lc', command], { cwd: this.cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let resolveExit!: (code: number | null) => void
    const exited = new Promise<number | null>((resolve) => { resolveExit = resolve })
    const turn: ChildTurn = { process: childProcess, exited }
    this.child = turn
    childProcess.stdout?.pipe(process.stdout)
    childProcess.stderr?.pipe(process.stderr)
    childProcess.once('error', (error) => console.error(`[spex pi-headless] child spawn failed: ${error.message}`))
    childProcess.once('close', (code) => {
      if (this.child === turn) this.child = null
      resolveExit(code)
      // an aborted child leaves non-zero too; the session layer's interrupt marker reads that exit as the interrupt it was
      if (code !== 0 && !this.closing) void import('./harness.js').then(({ reportHeadlessTurnExit }) => reportHeadlessTurnExit(this.id, 'pi-headless', code, this.cwd))
    })
    await withTimeout(new Promise<void>((resolve, reject) => {
      childProcess.once('spawn', () => resolve())
      childProcess.once('error', reject)
    }), START_TIMEOUT_MS, `pi-headless child did not start for session ${this.id}`)
  }
}

export async function runPiHeadlessController(id: string, runtimeDir: string, piCmd: string, tail: string[]): Promise<void> {
  // runtimeDir is retained in the command shape for parity with claude-headless and future per-session output.
  mkdirSync(join(runtimeDir, 'sessions', id), { recursive: true })
  const controller = new PiHeadlessController(id, runtimeDir, piCmd)
  const resume = tail[0] === '--session'
  const prompt = resume ? undefined : tail[0] === '--session-id' ? tail.slice(2).join(' ') : tail.join(' ')
  await controller.start(prompt)
  await new Promise<void>((resolve) => {
    const stop = () => void controller.close().finally(resolve)
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    process.once('SIGHUP', stop)
  })
}
