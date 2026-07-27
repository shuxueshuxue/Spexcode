import { appendFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'

const resultPath = process.env.RESULT_PATH
const mode = process.env.MODE || 'draining-active'
if (!resultPath) throw new Error('RESULT_PATH is required')
const token = '71'.repeat(32)
const epoch = 7
const owner = { instanceId: 'fixture-supervisor-generation', pid: process.pid, startToken: 'fixture-supervisor-start' }
let statusReads = 0
let acquiredCapabilities = []
const record = (event) => appendFileSync(resultPath, `${JSON.stringify({ at: Date.now(), ...event })}\n`)
const body = async (req) => {
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

const rows = ['a1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222', 'c3333333-3333-4333-8333-333333333333', 'd4444444-4444-4444-8444-444444444444'].map((id) => ({
  id, node: null, branch: `node/${id.slice(0, 4)}`, path: `/tmp/${id}`, label: id, headline: id,
  raw: { name: null, title: null }, parent: null, harness: 'claude', capabilities: { headless: false },
  launcher: 'claude', lifecycle: 'active', proposal: null, merges: 0, status: 'working', liveness: 'online',
  note: null, archived: false, archiveHazard: null, prompt: null, promptPreview: null, created: 1, activity: null, sortKey: null,
}))

const server = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json')
  if (req.method === 'GET' && req.url === '/api/sessions?all=1') return res.end(JSON.stringify(rows))
  if (req.method === 'POST' && req.url === '/api/session-maintenance/acquire') {
    const input = await body(req)
    acquiredCapabilities = input.capabilities
    record({ step: 'acquire', input })
    const active = mode === 'heartbeat-loss' || mode === 'broker-concurrent' || mode === 'broker-transport-loss'
    res.statusCode = active ? 201 : 202
    return res.end(JSON.stringify({ state: active ? 'active' : 'draining', epoch, token, owner, capabilities: input.capabilities }))
  }
  if (req.method === 'GET' && req.url === '/api/session-maintenance') {
    statusReads++
    if (mode === 'expiry' && statusReads >= 2) {
      record({ step: 'status', state: 'open', epoch: epoch + 1 })
      return res.end(JSON.stringify({ state: 'open', epoch: epoch + 1, owner: null, capabilities: [] }))
    }
    const state = mode === 'draining-active' && statusReads >= 6 ? 'active' : 'draining'
    record({ step: 'status', state, epoch })
    if (state === 'draining') await new Promise((resolve) => setTimeout(resolve, mode === 'draining-active' ? 500 : 100))
    return res.end(JSON.stringify({ state, epoch, owner, capabilities: acquiredCapabilities }))
  }
  if (req.method === 'POST' && req.url === '/api/session-maintenance/heartbeat') {
    record({ step: 'heartbeat', header: req.headers['x-spexcode-session-maintenance'] ?? null, input: await body(req) })
    if (mode === 'heartbeat-loss') {
      res.statusCode = 409
      return res.end(JSON.stringify({ code: 'maintenance_conflict', error: 'fixture epoch lost' }))
    }
    return res.end(JSON.stringify({ ok: true, state: 'active', epoch, owner, capabilities: acquiredCapabilities }))
  }
  if (req.method === 'POST' && req.url === '/api/session-maintenance/release') {
    record({ step: 'release', header: req.headers['x-spexcode-session-maintenance'] ?? null, input: await body(req) })
    return res.end(JSON.stringify({ ok: true }))
  }
  const match = req.url?.match(/^\/api\/sessions\/([^/]+)\/(stop|resume|input)$/)
  if (req.method === 'POST' && match) {
    record({ step: 'operation', sessionId: match[1], op: match[2], header: req.headers['x-spexcode-session-maintenance'] ?? null, input: await body(req) })
    if (mode === 'broker-concurrent' && match[2] === 'stop') {
      const releasePath = process.env.BROKER_RELEASE_PATH
      if (!releasePath) throw new Error('BROKER_RELEASE_PATH is required')
      while (!existsSync(releasePath)) await new Promise((resolve) => setTimeout(resolve, 5))
    }
    return res.end(JSON.stringify({ ok: true }))
  }
  if (req.method === 'POST' && req.url === '/api/sessions') {
    record({ step: 'operation', op: 'create', header: req.headers['x-spexcode-session-maintenance'] ?? null, input: await body(req) })
    res.statusCode = 201
    return res.end(JSON.stringify(rows[3]))
  }
  res.statusCode = 404
  res.end(JSON.stringify({ error: 'not found' }))
})
server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing address')
  process.stdout.write(`READY ${address.port}\n`)
})
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)))
