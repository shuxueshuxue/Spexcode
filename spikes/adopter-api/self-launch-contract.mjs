import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = mkdtempSync(join(tmpdir(), 'adopter-self-launch-'))
const db = join(root, 'sessions.sqlite')
const cli = fileURLToPath(new URL('./self-launch-cli.mjs', import.meta.url))

function run(args, env = {}) {
  return execFileSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  }).trim()
}

function json(args, env) {
  return JSON.parse(run(args, env))
}

try {
  const initialized = json(['initialize', '--database-path', db, '--session-id', 'self-1'])
  if (initialized.sessionId !== 'self-1' || initialized.state !== 'active') throw new Error('initialize stdout contract')

  const queued = json([
    'enqueue', '--database-path', db, '--session-id', 'self-1', '--message-id', 'm-1',
    '--body', 'offline prompt', '--idempotency-key', 'ik-1',
  ])
  if (queued.messageId !== 'm-1' || queued.state !== 'pending') throw new Error('enqueue stdout contract')

  const listened = json(['dequeue', '--database-path', db, '--session-id', 'self-1'])
  if (listened.messageId !== 'm-1' || listened.body !== 'offline prompt' || listened.state !== 'dequeued') {
    throw new Error('dequeue/listener stdout contract')
  }

  const envDb = join(root, 'env.sqlite')
  const envInitialized = json(['initialize', '--session-id', 'env-1'], { SPEX_SESSION_DATABASE_PATH: envDb })
  if (envInitialized.sessionId !== 'env-1') throw new Error('environment path resolution contract')

  if (run(['dequeue', '--database-path', db, '--session-id', 'self-1']) !== 'null') {
    throw new Error('empty dequeue stdout contract')
  }

  process.stdout.write(JSON.stringify({ ok: true, databasePath: db }) + '\n')
} finally {
  rmSync(root, { recursive: true, force: true })
}
