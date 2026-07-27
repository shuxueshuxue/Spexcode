import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const ID = 'wwww2222-2222-4222-8222-222222222222'

function row(status: string, archived = false): Record<string, unknown> {
  return {
    id: ID, node: null, branch: 'node/watch-cli', label: ID, headline: ID,
    raw: { name: null, title: null }, path: `/wt/${ID}`, parent: null, harness: 'claude',
    capabilities: { headless: false }, launcher: null, lifecycle: 'active', proposal: null, merges: 0,
    status, liveness: status === 'offline' ? 'offline' : 'online', note: null, archived, archiveHazard: null,
    prompt: null, promptPreview: null, created: 0, activity: null, sortKey: null,
  }
}

async function runCli(args: string[], base: string, stopAfterMs?: number): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn('tsx', [cli, ...args, '--api', base], {
    cwd: pkgRoot, env: { ...process.env, SPEXCODE_API_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''; let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  if (stopAfterMs != null) setTimeout(() => child.kill('SIGTERM'), stopAfterMs).unref()
  const [code] = await once(child, 'close') as [number]
  return { code, stdout, stderr }
}

test('CLI watch/wait use active events plus all-record presence across archive and true close', { timeout: 20_000 }, async () => {
  let activeCalls = 0
  let historyCalls = 0
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/sessions') {
      activeCalls++
      // The default event projection hides the archive immediately and stays empty after true close.
      res.end(JSON.stringify(activeCalls === 1 ? [row('working')] : []))
      return
    }
    if (req.url === '/api/sessions?all=1') {
      historyCalls++
      // Presence sees the archive as an existing offline record, then sees its real removal.
      res.end(JSON.stringify(historyCalls === 1 ? [row('working')] : historyCalls <= 3 ? [row('offline', true)] : []))
      return
    }
    res.statusCode = 404; res.end('{}')
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address === 'object')
  const base = `http://127.0.0.1:${address.port}`

  try {
    const broad = await runCli(['session', 'watch', '--interval', '0.02'], base, 1500)
    assert.ok(broad.code === 0 || broad.code === 1 || broad.code === 130 || broad.code === 143 || broad.code === null, broad.stderr)
    assert.doesNotMatch(broad.stdout, /launched .*offline|\[spex\] offline/, 'broad watch must not enumerate archive rows')
    assert.equal((broad.stdout.match(/\[spex\] closed/g) ?? []).length, 1, broad.stdout)
    assert.ok(activeCalls > 1 && historyCalls > 2, 'broad watch must poll both projections')

    let waitCalls = 0
    server.removeAllListeners('request')
    server.on('request', (req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.url !== '/api/sessions?all=1') { res.statusCode = 404; res.end('{}'); return }
      // Explicit wait reuses one history snapshot per poll; each request is one lifecycle state.
      const phase = waitCalls++
      res.end(JSON.stringify([row(phase === 0 ? 'working' : 'offline', phase > 0)]))
    })
    const waited = await runCli(['session', 'wait', ID, '--interval', '0.02', '--timeout', '1'], base)
    assert.equal(waited.code, 0, waited.stderr)
    assert.match(waited.stdout, /working→offline/)
    assert.doesNotMatch(waited.stdout, /gone/i)
  } finally {
    server.close(); await once(server, 'close')
  }
})
