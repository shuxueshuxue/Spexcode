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
