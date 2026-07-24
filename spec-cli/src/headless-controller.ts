import { createConnection, type Socket } from 'node:net'
import type { DispatchResult } from './harness.js'

export type ControlRequestLabel = {
  name: string
  session: string
  timeoutMs: number
  rejected: string
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

export function controlRequest(
  sockPath: string,
  request: object,
  label: ControlRequestLabel,
): Promise<DispatchResult> {
  return new Promise((resolve) => {
    let socket: Socket | undefined
    let buffer = ''
    let settled = false
    const finish = (result: DispatchResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket?.destroy()
      resolve(result)
    }
    const timer = setTimeout(
      () => finish({ ok: false, error: `${label.name} control timed out for session ${label.session}` }),
      label.timeoutMs,
    )
    try {
      socket = createConnection(sockPath)
    } catch (error) {
      finish({ ok: false, error: `${label.name} controller connect failed for session ${label.session}: ${(error as Error).message}` })
      return
    }
    socket.setEncoding('utf8')
    socket.on('connect', () => socket!.write(`${JSON.stringify(request)}\n`))
    socket.on('data', (chunk) => {
      buffer += chunk
      const nl = buffer.indexOf('\n')
      if (nl < 0) return
      try {
        const response = JSON.parse(buffer.slice(0, nl)) as DispatchResult
        finish(response.ok ? { ok: true } : { ok: false, error: response.error || label.rejected })
      } catch (error) {
        finish({ ok: false, error: `${label.name} returned an invalid control response: ${(error as Error).message}` })
      }
    })
    socket.on('error', (error) => finish({ ok: false, error: `${label.name} controller unreachable for session ${label.session}: ${error.message}` }))
    socket.on('close', () => finish({ ok: false, error: `${label.name} controller closed before confirming session ${label.session}` }))
  })
}
