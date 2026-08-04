import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import http from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')
const project = join(packageRoot, '..')
const tsxCli = join(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist', 'cli.mjs')
const cli = join(here, 'cli.ts')
const sender = 'sender-1111-2222-3333-444444444444'
const recipient = 'recipient-1111-2222-3333-444444444444'

type Run = { code: number | null; out: string; err: string }
type Input = { text: string; from?: string }

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<Run> {
  const child = spawn(process.execPath, [tsxCli, cli, ...args], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = '', err = ''
  child.stdout.on('data', (chunk) => { out += String(chunk) })
  child.stderr.on('data', (chunk) => { err += String(chunk) })
  await once(child, 'close')
  return { code: child.exitCode, out, err }
}

test('session send puts only the sender/reply line on the wire; artifact guidance stays in the materialized contract', async () => {
  const delivered: Input[] = []
  const rows = [
    { id: sender, name: 'sender headline', activity: null, promptPreview: null, node: null, title: 'sender title', branch: 'node/sender' },
    { id: recipient, name: null, activity: null, promptPreview: null, node: null, title: 'recipient title', branch: 'node/recipient' },
  ]
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://fixture')
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(rows))
      return
    }
    if (req.method === 'POST' && url.pathname === `/api/sessions/${recipient}/input`) {
      let body = ''
      for await (const chunk of req) body += chunk
      delivered.push(JSON.parse(body))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    res.writeHead(404)
    res.end(`not found: ${req.method} ${req.url}`)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const base = `http://127.0.0.1:${address.port}`
  const cleanEnv: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_API_URL: '' }
  for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete cleanEnv[key]

  try {
    const agent = await runCli(['session', 'send', recipient, 'please inspect the result', '--api', base], { ...cleanEnv, SPEXCODE_SESSION_ID: sender })
    assert.equal(agent.code, 0, agent.err)
    assert.equal(agent.out.trim(), 'sent')
    assert.deepEqual(delivered[0], {
      from: sender,
      kind: 'text',
      text: `please inspect the result\n\n— from session "sender title" (${sender}). To reply: spex session send ${sender} "<your reply>"`,
    })

    const human = await runCli(['session', 'send', recipient, 'plain shell message', '--api', base], cleanEnv)
    assert.equal(human.code, 0, human.err)
    assert.equal(human.out.trim(), 'sent')
    assert.deepEqual(delivered[1], { kind: 'text', text: 'plain shell message' })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
