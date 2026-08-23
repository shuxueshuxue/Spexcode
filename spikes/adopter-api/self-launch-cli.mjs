#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { openProtocol } from './protocol.mjs'

function value(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function databasePath() {
  const explicit = value('database-path')
  if (explicit) return explicit
  if (process.env.SPEX_SESSION_DATABASE_PATH) return process.env.SPEX_SESSION_DATABASE_PATH
  const config = process.env.SPEX_SESSION_CONFIG || join(homedir(), '.spexcode', 'session.json')
  if (existsSync(config)) {
    const parsed = JSON.parse(readFileSync(config, 'utf8'))
    if (typeof parsed.databasePath === 'string') return parsed.databasePath
  }
  return join(homedir(), '.spexcode', 'sessions.sqlite')
}

function required(name) {
  const result = value(name)
  if (!result) throw new Error(`missing --${name}`)
  return result
}

function main() {
  const verb = process.argv[2]
  const path = databasePath()
  if (!isAbsolute(path)) throw new Error('databasePath must be absolute')
  const protocol = openProtocol(path)
  try {
    if (verb === 'initialize') {
      process.stdout.write(JSON.stringify(protocol.initialize(required('session-id'))) + '\n')
      return
    }
    if (verb === 'enqueue') {
      const sessionId = required('session-id')
      const message = protocol.enqueue(sessionId, {
        messageId: required('message-id'), targetSessionId: sessionId, body: required('body'),
        idempotencyKey: value('idempotency-key'),
      })
      process.stdout.write(JSON.stringify({ ...message, body: message.body.toString('utf8') }) + '\n')
      return
    }
    if (verb === 'dequeue') {
      const message = protocol.dequeue(required('session-id'))
      process.stdout.write(JSON.stringify(message && { ...message, body: message.body.toString('utf8') }) + '\n')
      return
    }
    throw new Error('usage: self-launch-cli.mjs initialize|enqueue|dequeue')
  } finally {
    protocol.close()
  }
}

try {
  main()
} catch (error) {
  const code = error?.code || 'USAGE'
  process.stderr.write(`self-launch-cli: ${code}: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(code === 'USAGE' ? 2 : 1)
}
