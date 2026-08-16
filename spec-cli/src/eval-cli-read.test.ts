import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn('tsx', [cli, ...args], {
    cwd: pkgRoot,
    env: { ...process.env, SPEXCODE_API_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  const [code] = await once(child, 'close') as [number]
  return { code, stdout, stderr }
}

test('session eval text preserves result-first order and uses only the own-reading marker', async () => {
  const id = '11111111-2222-4333-8444-555555555555'
  const items = [
    {
      node: 'a-node', filterKind: 'result', scenario: 'a-result',
      verdict: { status: 'fail' }, fresh: false, staleAxes: ['code'], inSession: false,
      ts: '2026-01-02T00:10:00.000Z',
    },
    {
      node: 'b-node', filterKind: 'result', scenario: 'b-result',
      verdict: { status: 'pass' }, fresh: true, staleAxes: [], inSession: true,
      ts: '2026-01-02T00:09:00.000Z',
    },
    { node: 'a-node', filterKind: 'blind', scenario: 'a-blind' },
    { node: 'b-node', filterKind: 'blind', scenario: 'b-blind' },
  ]
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/sessions?all=1') {
      res.end(JSON.stringify([{ id }]))
      return
    }
    if (req.url?.startsWith('/api/evals?')) {
      res.end(JSON.stringify({
        items, page: 1, pageCount: 1, total: items.length, unknown: 0, revision: 'fixture',
        gates: [{ label: 'lint', ok: true, detail: '0 error(s)' }],
      }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  const { code, stdout, stderr } = await runCli(['eval', 'ls', '--session', id, '--api', `http://127.0.0.1:${address.port}`])
  server.close()
  await once(server, 'close')

  assert.equal(code, 0, stderr)
  const positions = ['a-result', 'b-result', 'a-blind', 'b-blind']
    .map((scenario) => stdout.indexOf(scenario))
  assert.ok(positions.every((position) => position >= 0), stdout)
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, stdout)
  assert.doesNotMatch(stdout, /inherited baseline/i)
  assert.match(stdout, /\n\s+✦ ✓ pass\s+b-result/)
  assert.match(stdout, /\n\s+✗ fail.*\s+a-result/)
})

test('eval help teaches the same global result-first session order', async () => {
  const { code, stdout, stderr } = await runCli(['eval', '--help'])
  assert.equal(code, 0, stderr)
  assert.match(stdout, /newest-first across nodes and source ownership/i)
  assert.match(stdout, /blind spots follow measured rows/i)
  assert.doesNotMatch(stdout, /blind spots first|ahead of the inherited baseline/i)
})

test('session eval text omits the empty paged-list gate section', async () => {
  const id = '22222222-3333-4444-8555-666666666666'
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/sessions?all=1') return void res.end(JSON.stringify([{ id }]))
    if (req.url?.startsWith('/api/evals?')) return void res.end(JSON.stringify({
      items: [{ node: 'gate-free', filterKind: 'blind', scenario: 'visible-row' }],
      page: 1, pageCount: 1, total: 1, unknown: 0, revision: 'fixture', gates: [],
    }))
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  const { code, stdout, stderr } = await runCli(['eval', 'ls', '--session', id, '--api', `http://127.0.0.1:${address.port}`])
  server.close()
  await once(server, 'close')

  assert.equal(code, 0, stderr)
  assert.match(stdout, /visible-row/)
  assert.doesNotMatch(stdout, /^\s*gates\s*:/m)
})

test('session eval aggregates stable snapshot pages whose response revisions differ', async () => {
  const id = '33333333-4444-4555-8666-777777777777'
  const snapshot = { epoch: 'epoch-a', generation: 7, content: 'content-a' }
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/sessions?all=1') return void res.end(JSON.stringify([{ id }]))
    if (req.url?.startsWith('/api/evals?')) {
      const page = Number(new URL(req.url, 'http://fixture').searchParams.get('page'))
      return void res.end(JSON.stringify({
        items: [{ node: `node-${page}`, filterKind: 'blind', scenario: `scenario-${page}` }],
        page, pageCount: 2, total: 2, unknown: 0, revision: `page-response-${page}`,
        evalRevision: snapshot, gates: [],
      }))
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  const { code, stdout, stderr } = await runCli(['eval', 'ls', '--session', id, '--json', '--api', `http://127.0.0.1:${address.port}`])
  server.close()
  await once(server, 'close')

  assert.equal(code, 0, stderr)
  const model = JSON.parse(stdout)
  assert.deepEqual(model.items.map((item: any) => item.scenario), ['scenario-1', 'scenario-2'])
  assert.deepEqual(model.evalRevision, snapshot)
  assert.equal(model.revision, 'page-response-1')
})

test('session eval discards a drifted partial snapshot and retries from page one', async () => {
  const id = '44444444-5555-4666-8777-888888888888'
  let evalRequests = 0
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/sessions?all=1') return void res.end(JSON.stringify([{ id }]))
    if (req.url?.startsWith('/api/evals?')) {
      evalRequests++
      const page = Number(new URL(req.url, 'http://fixture').searchParams.get('page'))
      const attempt = Math.ceil(evalRequests / 2)
      const evalRevision = attempt === 1
        ? page === 1
          ? { epoch: 'epoch-b', generation: 1, content: '2:old' }
          : { epoch: 'epoch-b:1', generation: 2, content: 'old' }
        : { epoch: 'epoch-b', generation: 3, content: 'stable' }
      return void res.end(JSON.stringify({
        items: [{ node: `attempt-${attempt}`, filterKind: 'blind', scenario: `attempt-${attempt}-page-${page}` }],
        page, pageCount: 2, total: 2, unknown: 0, revision: `response-${evalRequests}`,
        evalRevision, gates: [],
      }))
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  const { code, stdout, stderr } = await runCli(['eval', 'ls', '--session', id, '--json', '--api', `http://127.0.0.1:${address.port}`])
  server.close()
  await once(server, 'close')

  assert.equal(code, 0, stderr)
  assert.equal(evalRequests, 4)
  assert.deepEqual(JSON.parse(stdout).items.map((item: any) => item.scenario), ['attempt-2-page-1', 'attempt-2-page-2'])
})

test('session eval fails loudly after two continuously drifted snapshot attempts', async () => {
  const id = '55555555-6666-4777-8888-999999999999'
  let evalRequests = 0
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/sessions?all=1') return void res.end(JSON.stringify([{ id }]))
    if (req.url?.startsWith('/api/evals?')) {
      evalRequests++
      const page = Number(new URL(req.url, 'http://fixture').searchParams.get('page'))
      return void res.end(JSON.stringify({
        items: [{ node: 'moving', filterKind: 'blind', scenario: `discarded-${evalRequests}` }],
        page, pageCount: 2, total: 2, unknown: 0, revision: `response-${evalRequests}`,
        evalRevision: { epoch: 'epoch-c', generation: evalRequests, content: `content-${evalRequests}` }, gates: [],
      }))
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  const { code, stdout, stderr } = await runCli(['eval', 'ls', '--session', id, '--json', '--api', `http://127.0.0.1:${address.port}`])
  server.close()
  await once(server, 'close')

  assert.equal(code, 1)
  assert.equal(stdout, '')
  assert.equal(evalRequests, 4)
  assert.match(stderr, /snapshot changed during both fetch attempts/)
  assert.match(stderr, /attempt 1: epoch-c@1 \(content-1\) -> epoch-c@2 \(content-2\) at page 2/)
  assert.match(stderr, /attempt 2: epoch-c@3 \(content-3\) -> epoch-c@4 \(content-4\) at page 2/)
})
