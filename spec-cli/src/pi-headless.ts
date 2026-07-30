import { createServer, type Server, type Socket } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DispatchResult, HarnessDeliveryRecord } from './harness.js'
import { controlRequest, withTimeout } from './headless-controller.js'
import { shQuote } from './sh.js'

type ControlRequest = { type: 'deliver'; text: string; mid?: string }
type ChildTurn = { process: ChildProcess; exited: Promise<number | null> }

const PKG = fileURLToPath(new URL('..', import.meta.url))
const SPEX = join(PKG, 'bin', 'spex.mjs')
const CONTROL_TIMEOUT_MS = 30_000
const START_TIMEOUT_MS = 30_000

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
    if (child && child.process.exitCode === null) child.process.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve()
      this.server.close(() => resolve())
    })
    // same proof-before-removal rule as every other teardown (harness.ts unlinkSocks): a socket path is keyed
    // by session id alone, so only a listener PROVEN dead is ours to unlink.
    const { rvSock, unlinkSocks } = await import('./harness.js')
    await unlinkSocks(this.socketPath, rvSock(this.id))
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

  private async handle(request: ControlRequest): Promise<DispatchResult> {
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
