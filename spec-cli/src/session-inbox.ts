// The caller's own inbox — receipt as an act the recipient performs, in three deliberately distinct shapes.
//
// A governed session normally never looks for its mail: the backend that owns its adapter hands each queued
// message over as an ordinary prompt. A self-launched harness has no such backend, and a governed one may be
// running with its backend down. Both read the same canonical queue through these three verbs:
//
//   dequeue         one-shot: take at most one message now, print it, exit. Empty queue is a normal `null`.
//   wait-dequeue    a background command: block until one message arrives (or the deadline), take it, exit.
//                   Its EXIT is the wake-up — the shape a harness's "run in background, notify on exit" wants.
//   stream-dequeue  a persistent monitor: one line per message as each arrives, never exits on its own.
//                   The shape a harness's line-oriented monitor wants (`tail -f`, not `until`).
//
// All three consume at-most-once through the protocol's dequeue transaction, so a message printed here is gone
// from the queue — the same contract the backend's adapter drain has. None of them creates an address, polls a
// backend, or reads anything but the caller's own row.
import { MESSAGE_KINDS, type Message } from '@spexcode/session-protocol'
import type { ProductionSessionApplication } from '@spexcode/session-application'
import { envSessionId } from '@spexcode/spec-core'
import { configuredSessionApplication, sessionApplicationCutoverState } from './session-application.js'

export type InboxMessage = {
  messageId: string
  kind: string
  from: string | null
  enqueuedAt: string
  text?: string
  bodyBase64?: string
}

/** The address a receive verb reads: an explicit `--session` full id, else this process's own session identity. */
export function inboxAddress(explicit?: string): string {
  const id = explicit?.trim() || envSessionId()
  if (!id) throw new Error('no session identity in this shell — pass --session <full-id> or run inside a session (SPEXCODE_SESSION_ID / the harness session variable)')
  return id
}

/** Take the head of the queue at-most-once. A lost race (another consumer took the head between read and dequeue) retries on the new head. */
export function takeOne(application: ProductionSessionApplication, sessionId: string): Message | null {
  for (let attempt = 0; attempt < 16; attempt++) {
    const head = application.readPendingMessages(sessionId)[0]
    if (!head) return null
    const taken = application.dequeuePendingMessage(sessionId, head.messageId)
    if (taken) return taken
  }
  throw new Error(`inbox ${sessionId}: the queue head kept changing under this reader; nothing was consumed`)
}

const utf8 = new TextDecoder('utf-8', { fatal: true })

/** A message as the caller sees it: text when the body is UTF-8, otherwise the opaque bytes as base64 so nothing is lost. */
export function renderInbox(message: Message): InboxMessage {
  const out: InboxMessage = {
    messageId: message.messageId,
    kind: message.kind,
    from: message.senderSessionId ?? null,
    enqueuedAt: new Date(message.enqueuedAtMs).toISOString(),
  }
  try { out.text = utf8.decode(message.body) }
  catch { out.bodyBase64 = Buffer.from(message.body).toString('base64') }
  return out
}

/** One line for a monitor / a header plus verbatim body for a person. */
export function formatInbox(message: InboxMessage, mode: 'json' | 'line' | 'block'): string {
  if (mode === 'json') return JSON.stringify(message)
  const from = message.from ?? 'human'
  const kind = message.kind === MESSAGE_KINDS.SESSION_TEXT || message.kind === 'session.prompt.v1' ? '' : ` · ${message.kind}`
  if (mode === 'line') {
    const body = message.text !== undefined ? message.text.replace(/\s*\n\s*/g, ' ⏎ ') : `<${Buffer.from(message.bodyBase64!, 'base64').length} opaque bytes, base64 ${message.bodyBase64}>`
    return `[spex] message · from ${from}${kind} · ${message.messageId} · ${message.enqueuedAt}: ${body}`
  }
  const header = `from ${from}${kind} · ${message.messageId} · ${message.enqueuedAt}`
  return message.text !== undefined
    ? `${header}\n${message.text}`
    : `${header}\nopaque body (not UTF-8), base64:\n${message.bodyBase64}`
}

export type WaitOptions = { timeoutMs: number; intervalMs: number }

/** Block until one message can be taken, or the deadline passes (null). Polling is the honest primitive here: the
 * protocol's wake hints only lower latency and are never required for correctness. */
export async function waitForOne(application: ProductionSessionApplication, sessionId: string, opts: WaitOptions): Promise<Message | null> {
  const deadline = Date.now() + Math.max(0, opts.timeoutMs)
  const interval = Math.max(50, opts.intervalMs)
  for (;;) {
    const taken = takeOne(application, sessionId)
    if (taken) return taken
    if (Date.now() >= deadline) return null
    await new Promise(resolve => setTimeout(resolve, interval))
  }
}

/** Emit every message as it arrives, forever. Resolves only when `stop` fires (a signal); each emitted message was consumed. */
export async function streamInbox(application: ProductionSessionApplication, sessionId: string, intervalMs: number, emit: (message: Message) => void, stop: { stopped: boolean }): Promise<void> {
  const interval = Math.max(50, intervalMs)
  while (!stop.stopped) {
    let taken = takeOne(application, sessionId)
    while (taken) { emit(taken); if (stop.stopped) return; taken = takeOne(application, sessionId) }
    await new Promise(resolve => setTimeout(resolve, interval))
  }
}

export type RegisterOutcome = { registered: true; sessionId: string } | { registered: false; reason: string }

/** The SessionStart registration a self-launched harness gets through its hook: initialize the native session id as
 * a protocol address in the project's canonical store. Only a store that already exists and is ready is written to —
 * a project with no governed backend has nothing to register into, and registration must never create a store. */
export function registerSessionAddress(sessionId: string): RegisterOutcome {
  const id = sessionId.trim()
  if (!id) return { registered: false, reason: 'empty session id' }
  const state = sessionApplicationCutoverState()
  if (state !== 'ready') return { registered: false, reason: `no ready canonical store here (cutover state ${state}); nothing to register into` }
  const application = configuredSessionApplication()
  application.protocol.initialize(id)
  return { registered: true, sessionId: id }
}
