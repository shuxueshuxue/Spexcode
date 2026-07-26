import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))

test('session eval text preserves result-first order and uses only the own-reading marker', async () => {
  const id = '11111111-2222-4333-8444-555555555555'
  const items = [
    {
      node: 'proof-cli-fixture', filterKind: 'result', scenario: 'fixture-stale',
      verdict: { status: 'fail' }, fresh: false, staleAxes: ['code'], inSession: false,
      ts: '2026-01-02T00:10:00.000Z',
    },
    {
      node: 'proof-cli-fixture', filterKind: 'result', scenario: 'fixture-inherited',
      verdict: { status: 'pass' }, fresh: true, staleAxes: [], inSession: false,
      ts: '2026-01-02T00:09:00.000Z',
    },
    {
      node: 'proof-cli-fixture', filterKind: 'result', scenario: 'fixture-own',
      verdict: { status: 'pass' }, fresh: true, staleAxes: [], inSession: true,
      ts: '2026-01-02T00:07:00.000Z',
    },
    { node: 'proof-cli-fixture', filterKind: 'blind', scenario: 'fixture-blind' },
  ]
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/sessions') {
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

  const child = spawn('tsx', [cli, 'eval', 'ls', '--session', id, '--api', `http://127.0.0.1:${address.port}`], {
    cwd: pkgRoot,
    env: { ...process.env, SPEXCODE_API_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  const [code] = await once(child, 'close') as [number]
  server.close()
  await once(server, 'close')

  assert.equal(code, 0, stderr)
  const positions = ['fixture-stale', 'fixture-inherited', 'fixture-own', 'fixture-blind']
    .map((scenario) => stdout.indexOf(scenario))
  assert.ok(positions.every((position) => position >= 0), stdout)
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, stdout)
  assert.doesNotMatch(stdout, /inherited baseline/i)
  assert.match(stdout, /\n\s+✦ ✓ pass\s+fixture-own/)
  assert.match(stdout, /\n\s+✓ pass\s+fixture-inherited/)
})
