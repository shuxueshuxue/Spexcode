import { appendFileSync, mkdirSync, rmSync } from 'node:fs'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DispatchResult, HarnessDeliveryRecord } from './harness.js'

type ControlRequest = { type: 'deliver'; text: string; mode: 'steer' | 'wake' } | { type: 'interrupt' }
type ClaudeHeadlessDeliveryRecord = HarnessDeliveryRecord & { status?: string }
type ChildTurn = {
  process: ChildProcessWithoutNullStreams
  active: boolean
  completed: boolean
  exited: Promise<number | null>
  teardown: Promise<void> | null
  result: Promise<void>
  sawResult: () => void
  firstEvent: Promise<void>
  sawFirstEvent: () => void
  interruptAcks: Map<string, () => void>
}

const PKG = fileURLToPath(new URL('..', import.meta.url))
const SPEX = join(PKG, 'bin', 'spex.mjs')
const CONTROL_TIMEOUT_MS = 60_000
const START_TIMEOUT_MS = 30_000
const INTERRUPT_TIMEOUT_MS = 10_000
const RESULT_WAIT_MS = 20_000
const RESULT_EXIT_GRACE_MS = 500
const TERM_EXIT_GRACE_MS = 500
const KILL_EXIT_GRACE_MS = 2_000

const shQuote = (s: string) => `'${s.replace(/'/g, `'\''`)}'`
const userEvent = (text: string) => JSON.stringify({
  type: 'user',
  message: { role: 'user', content: [{ type: 'text', text }] },
})

export const claudeHeadlessSock = (id: string) => join(tmpdir(), `spexcode-ch-${id}.sock`)

export function claudeHeadlessLaunchCommand(id: string, runtimeDir: string, claudeCmd: string): string {
  return [shQuote(SPEX), 'internal', 'claude-headless-run', shQuote(id), shQuote(runtimeDir), shQuote(claudeCmd), '--'].join(' ')
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

function controlRequest(id: string, request: ControlRequest): Promise<DispatchResult> {
  return new Promise((resolve) => {
    const socket = createConnection(claudeHeadlessSock(id))
    let buffer = ''
    let settled = false
    const finish = (result: DispatchResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(result)
    }
    const timer = setTimeout(() => finish({ ok: false, error: `claude-headless control timed out for session ${id}` }), CONTROL_TIMEOUT_MS)
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', (chunk) => {
      buffer += chunk
      const nl = buffer.indexOf('\n')
      if (nl < 0) return
      try {
        const response = JSON.parse(buffer.slice(0, nl)) as DispatchResult
        finish(response.ok ? { ok: true } : { ok: false, error: response.error || 'claude-headless control rejected the request' })
      } catch (error) {
        finish({ ok: false, error: `claude-headless returned an invalid control response: ${(error as Error).message}` })
      }
    })
    socket.on('error', (error) => finish({ ok: false, error: `claude-headless controller unreachable for session ${id}: ${error.message}` }))
    socket.on('close', () => finish({ ok: false, error: `claude-headless controller closed before confirming session ${id}` }))
  })
}

export const deliverViaClaudeHeadless = (rec: ClaudeHeadlessDeliveryRecord, text: string) =>
  controlRequest(rec.session, { type: 'deliver', text, mode: rec.status === 'active' ? 'steer' : 'wake' })

export const interruptClaudeHeadless = (rec: HarnessDeliveryRecord) =>
  controlRequest(rec.session, { type: 'interrupt' })

export class ClaudeHeadlessController {
  private server: Server | null = null
  private child: ChildTurn | null = null
  private controlQueue: Promise<void> = Promise.resolve()
  private closing = false
  private readonly messagesPath: string
  private readonly socketPath: string

  constructor(
    private readonly id: string,
    runtimeDir: string,
    private readonly claudeCmd: string,
    private readonly cwd = process.cwd(),
  ) {
    const dir = join(runtimeDir, 'sessions', id)
    mkdirSync(dir, { recursive: true })
    this.messagesPath = join(dir, 'messages.ndjson')
    this.socketPath = claudeHeadlessSock(id)
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
      console.error(`[spex claude-headless] initial turn failed: ${(error as Error).message}`)
    })
  }

  async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    const child = this.child
    try {
      if (child) await this.ensureTurnExit(child)
    } finally {
      await new Promise<void>((resolve) => {
        if (!this.server) return resolve()
        this.server.close(() => resolve())
      })
      try { rmSync(this.socketPath, { force: true }) } catch { /* best-effort cleanup after close */ }
    }
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
      try {
        request = JSON.parse(buffer.slice(0, nl)) as ControlRequest
      } catch (error) {
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
    if (request.type === 'deliver') {
      if (!request.text) return { ok: false, error: 'empty prompt - nothing to deliver' }
      const current = this.child
      if (request.mode === 'steer' && current?.active && current.process.stdin.writable) {
        await this.writeLine(current, userEvent(request.text))
        return { ok: true }
      }
      if (current?.active) {
        await Promise.race([
          withTimeout(current.result, RESULT_WAIT_MS, 'previous claude-headless turn did not reach its result before idle wake'),
          current.exited.then((code) => { throw new Error(`previous claude-headless turn exited before its result (code ${code ?? 'signal'})`) }),
        ])
      }
      if (current) await this.ensureTurnExit(current)
      await this.spawnTurn(request.text, true)
      return { ok: true }
    }
    if (request.type === 'interrupt') return this.interrupt()
    return { ok: false, error: 'unknown claude-headless control request' }
  }

  private async interrupt(): Promise<DispatchResult> {
    const child = this.child
    if (!child?.active || !child.process.stdin.writable) return { ok: true }
    const requestId = randomUUID()
    const ack = new Promise<void>((resolve) => child.interruptAcks.set(requestId, resolve))
    await this.writeLine(child, JSON.stringify({
      type: 'control_request',
      request_id: requestId,
      request: { subtype: 'interrupt' },
    }))
    try {
      await withTimeout(ack, INTERRUPT_TIMEOUT_MS, `claude-headless interrupt was not confirmed for session ${this.id}`)
      return { ok: true }
    } finally {
      child.interruptAcks.delete(requestId)
    }
  }

  private async spawnTurn(text: string, resume: boolean): Promise<void> {
    if (this.closing) throw new Error('claude-headless controller is closing')
    const mode = resume ? ['--resume', this.id] : ['--session-id', this.id]
    const args = ['-p', ...mode, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']
    const command = `exec ${this.claudeCmd} ${args.map(shQuote).join(' ')}`
    const childProcess = spawn('/bin/sh', ['-lc', command], {
      cwd: this.cwd,
      env: process.env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let sawFirstEvent!: () => void
    const firstEvent = new Promise<void>((resolve) => { sawFirstEvent = resolve })
    let resolveExit!: (code: number | null) => void
    const exited = new Promise<number | null>((resolve) => { resolveExit = resolve })
    let sawResult!: () => void
    const result = new Promise<void>((resolve) => { sawResult = resolve })
    const turn: ChildTurn = {
      process: childProcess,
      active: true,
      completed: false,
      exited,
      teardown: null,
      result,
      sawResult,
      firstEvent,
      sawFirstEvent,
      interruptAcks: new Map(),
    }
    this.child = turn
    let stdoutBuffer = ''
    childProcess.stdout.setEncoding('utf8')
    childProcess.stderr.pipe(process.stderr)
    childProcess.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk
      for (;;) {
        const nl = stdoutBuffer.indexOf('\n')
        if (nl < 0) break
        const line = stdoutBuffer.slice(0, nl)
        stdoutBuffer = stdoutBuffer.slice(nl + 1)
        const nativeLine = `${line}\n`
        appendFileSync(this.messagesPath, nativeLine)
        globalThis.process.stdout.write(nativeLine)
        turn.sawFirstEvent()
        this.observeEvent(turn, line)
      }
    })
    childProcess.once('error', (error) => {
      console.error(`[spex claude-headless] child spawn failed: ${error.message}`)
    })
    childProcess.once('close', (code) => {
      turn.active = false
      if (stdoutBuffer) console.error('[spex claude-headless] dropped a partial non-line stdout event')
      if (this.child === turn) this.child = null
      resolveExit(code)
      if (!turn.completed && code !== 0 && !this.closing) {
        void import('./harness.js').then(({ reportHeadlessTurnExit }) => reportHeadlessTurnExit(this.id, 'claude-headless', code, this.cwd))
      }
    })
    await this.writeLine(turn, userEvent(text))
    await Promise.race([
      withTimeout(turn.firstEvent, START_TIMEOUT_MS, `claude-headless child produced no stream event for session ${this.id}`),
      turn.exited.then((code) => { throw new Error(`claude-headless child exited before accepting the turn (code ${code ?? 'signal'})`) }),
    ])
  }

  private observeEvent(turn: ChildTurn, line: string): void {
    let event: any
    try { event = JSON.parse(line) } catch { return }
    if (event?.type === 'control_response' && typeof event?.response?.request_id === 'string') {
      turn.interruptAcks.get(event.response.request_id)?.()
    }
    if (event?.type === 'result' && !turn.completed) {
      turn.completed = true
      turn.active = false
      turn.sawResult()
      void this.ensureTurnExit(turn).catch((error) => {
        console.error(`[spex claude-headless] completed turn teardown failed: ${(error as Error).message}`)
      })
    }
  }

  private ensureTurnExit(turn: ChildTurn): Promise<void> {
    turn.teardown ??= this.terminateTurn(turn)
    return turn.teardown
  }

  private async terminateTurn(turn: ChildTurn): Promise<void> {
    if (turn.completed) {
      if (turn.process.stdin.writable) turn.process.stdin.end()
      if (await this.waitForTurnExit(turn, RESULT_EXIT_GRACE_MS)) return
      this.signalTurn(turn, 'SIGKILL')
      await withTimeout(
        turn.exited,
        KILL_EXIT_GRACE_MS,
        `claude-headless completed turn process group ${turn.process.pid ?? 'unknown'} did not exit after SIGKILL`,
      )
      return
    }
    this.signalTurn(turn, 'SIGTERM')
    if (await this.waitForTurnExit(turn, TERM_EXIT_GRACE_MS)) return
    this.signalTurn(turn, 'SIGKILL')
    await withTimeout(
      turn.exited,
      KILL_EXIT_GRACE_MS,
      `claude-headless turn process group ${turn.process.pid ?? 'unknown'} did not exit after SIGKILL`,
    )
  }

  private async waitForTurnExit(turn: ChildTurn, timeoutMs: number): Promise<boolean> {
    try {
      await withTimeout(turn.exited, timeoutMs, 'turn exit grace elapsed')
      return true
    } catch {
      return false
    }
  }

  private signalTurn(turn: ChildTurn, signal: NodeJS.Signals): void {
    const pid = turn.process.pid
    try {
      if (pid) process.kill(-pid, signal)
      else turn.process.kill(signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }

  private writeLine(turn: ChildTurn, line: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!turn.process.stdin.writable) return reject(new Error('claude-headless child stdin is not writable'))
      turn.process.stdin.write(`${line}\n`, (error) => error ? reject(error) : resolve())
    })
  }
}

export async function runClaudeHeadlessController(
  id: string,
  runtimeDir: string,
  claudeCmd: string,
  tail: string[],
): Promise<void> {
  const controller = new ClaudeHeadlessController(id, runtimeDir, claudeCmd)
  const resume = tail[0] === '--resume'
  const prompt = resume ? undefined : tail[0] === '--session-id' ? tail.slice(2).join(' ') : tail.join(' ')
  await controller.start(prompt)
  await new Promise<void>((resolve) => {
    const stop = () => void controller.close().finally(resolve)
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    process.once('SIGHUP', stop)
  })
}
