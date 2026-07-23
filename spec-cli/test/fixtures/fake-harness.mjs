#!/usr/bin/env node

import { createServer } from 'node:net'
import { unlinkSync } from 'node:fs'

const socketPath = (process.env.CLAUDE_BG_RENDEZVOUS_SOCK || '').trim()
const sessionId = (process.env.SPEXCODE_SESSION_ID || '').trim() || 'unknown'
const intervalMs = Math.max(20, Number.parseInt(process.env.FAKE_HARNESS_INTERVAL_MS || '120', 10) || 120)

if (!socketPath) {
  console.error('fake-harness: CLAUDE_BG_RENDEZVOUS_SOCK is required')
  process.exit(2)
}

try { unlinkSync(socketPath) } catch { /* no stale socket */ }

let tick = 0
let timer
let closed = false
const write = (line) => process.stdout.write(`${line}\n`)
const compact = (value) => value.replace(/\s+/g, ' ').trim().slice(0, 240)

const server = createServer((connection) => {
  let buffer = ''
  connection.on('error', () => {})
  connection.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      let message
      try { message = JSON.parse(line) } catch { continue }
      if (message?.type === 'reply' && typeof message.text === 'string') {
        write(`FAKE-HARNESS REPLY ${compact(message.text)}`)
      } else if (message?.type === 'repaint') {
        connection.write(JSON.stringify({ type: 'repaint-done' }) + '\n')
      } else if (message?.type === 'ping') {
        connection.write(JSON.stringify({ type: 'pong' }) + '\n')
      }
    }
  })
})

const shutdown = () => {
  if (closed) return
  closed = true
  clearInterval(timer)
  try { server.close() } catch { /* already closed */ }
  try { unlinkSync(socketPath) } catch { /* already gone */ }
}
process.once('SIGTERM', () => { shutdown(); process.exit(0) })
process.once('SIGINT', () => { shutdown(); process.exit(0) })

server.on('error', (error) => {
  console.error(`fake-harness: rendezvous bind failed: ${error.message}`)
  shutdown()
  process.exit(1)
})
server.listen(socketPath, () => {
  write(`FAKE-HARNESS READY ${sessionId}`)
  timer = setInterval(() => write(`FAKE-HARNESS TICK ${++tick}`), intervalMs)
})
