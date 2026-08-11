import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const tsxCli = join(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist', 'cli.mjs')
const PARENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CHILD_WORKING = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CHILD_ASKING = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const CLOSED = 'deadbeef-dead-4bee-8bee-deadbeefdead'

function session(id: string, parent: string | null, status: string) {
  return {
    id, node: null, branch: null, label: id, title: id, raw: { name: null, title: null }, path: `/tmp/${id}`,
    parent, harness: 'fixture', capabilities: { headless: false }, launcher: null,
    lifecycle: 'active', proposal: null, merges: 0, status, liveness: 'online', note: null,
    archived: false, archiveHazard: null, prompt: null, promptPreview: null, created: 1, activity: null, sortKey: null,
  }
}

async function server(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const app = createServer(handler)
  app.listen(0, '127.0.0.1')
  await once(app, 'listening')
  const address = app.address()
  assert.ok(address && typeof address === 'object')
  return { app, api: `http://127.0.0.1:${address.port}` }
}

async function runLs(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const child = spawn(process.execPath, [tsxCli, cli, 'session', 'ls', ...args], {
    cwd: pkgRoot, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  const [code] = await once(child, 'close') as [number | null]
  return { code, stdout, stderr }
}

test('session ls projects parentage, a child scope, and status summary without stealing positional selectors', async () => {
  const rows = [
    session(PARENT, null, 'working'),
    session(CHILD_WORKING, PARENT, 'working'),
    session(CHILD_ASKING, PARENT, 'asking'),
    session(OTHER, null, 'working'),
  ]
  const { app, api } = await server((req, res) => {
    assert.equal(req.method, 'GET')
    assert.ok(req.url === '/api/sessions' || req.url === '/api/sessions?all=1')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(rows))
  })
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_SESSION_ID: PARENT }
    for (const key of ['CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'OPENCODE_SESSION_ID', 'PI_SESSION_ID']) delete env[key]
    const own = await runLs(['--children', '--api', api], env)
    assert.equal(own.code, 0, own.stderr)
    assert.match(own.stdout, new RegExp(`SpexCode children of ${PARENT.slice(0, 8)} \\(2; 1 working · 1 asking\\)`))
    assert.match(own.stdout, /\bPARENT\b/)
    assert.match(own.stdout, new RegExp(CHILD_WORKING.slice(0, 8)))
    assert.match(own.stdout, new RegExp(CHILD_ASKING.slice(0, 8)))
    assert.doesNotMatch(own.stdout, new RegExp(OTHER.slice(0, 8)))

    const filtered = await runLs(['--children', CHILD_ASKING.slice(0, 8), '--api', api], env)
    assert.equal(filtered.code, 0, filtered.stderr)
    assert.match(filtered.stdout, new RegExp(CHILD_ASKING.slice(0, 8)))
    assert.doesNotMatch(filtered.stdout, new RegExp(CHILD_WORKING.slice(0, 8)))

    const explicit = await runLs([`--children=${PARENT}`, '--api', api], env)
    assert.equal(explicit.code, 0, explicit.stderr)
    assert.match(explicit.stdout, new RegExp(CHILD_WORKING.slice(0, 8)))
    assert.match(explicit.stdout, new RegExp(CHILD_ASKING.slice(0, 8)))
  } finally {
    app.close()
    await once(app, 'close')
  }
})

test('session ls names terminal close history instead of collapsing it into a never-existed miss', async () => {
  const { app, api } = await server((req, res) => {
    if (req.url === '/api/sessions?all=1') {
      res.setHeader('content-type', 'application/json')
      res.end('[]')
      return
    }
    if (req.url === '/api/sessions/deadbeef/closure') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ id: CLOSED, closedAt: '2026-08-11T04:00:00.000Z' }))
      return
    }
    if (req.url === '/api/sessions/ffffffff/closure') {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'no terminal close history for this session' }))
      return
    }
    assert.fail(`unexpected request ${req.method} ${req.url}`)
  })
  try {
    const closed = await runLs(['--all', 'deadbeef', '--api', api])
    assert.equal(closed.code, 0, closed.stderr)
    assert.equal(closed.stderr, '')
    assert.match(closed.stdout, /deadbeef: closed at 2026-08-11T04:00:00.000Z/)

    const absent = await runLs(['--all', 'ffffffff', '--api', api])
    assert.equal(absent.code, 2)
    assert.equal(absent.stdout, '')
    assert.match(absent.stderr, /ffffffff was not found in this project's live, archive, or terminal-close history/)
  } finally {
    app.close()
    await once(app, 'close')
  }
})
