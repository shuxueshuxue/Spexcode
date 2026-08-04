import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const tsxCli = join(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist', 'cli.mjs')
const TARGET = 'send-parser-target'

type Run = { code: number | null; stdout: string; stderr: string }
type Request = { method: string; url: string; body: unknown }

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<Run> {
  const child = spawn(process.execPath, [tsxCli, cli, ...args], {
    cwd: pkgRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  const [code] = await once(child, 'close') as [number | null]
  return { code, stdout, stderr }
}

async function withBackend(run: (api: string, requests: Request[], env: NodeJS.ProcessEnv) => Promise<void>): Promise<void> {
  const requests: Request[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      requests.push({ method: req.method ?? '', url: req.url ?? '', body: text ? JSON.parse(text) : null })
      res.setHeader('content-type', 'application/json')
      if (req.method === 'GET' && req.url === '/api/sessions?all=1') {
        res.end(JSON.stringify([{ id: TARGET }]))
      } else if (req.method === 'POST' && req.url === `/api/sessions/${TARGET}/input`) {
        res.end(JSON.stringify({ ok: true }))
      } else {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'unexpected fixture route' }))
      }
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_API_URL: '' }
  for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete env[key]
  try {
    await run(`http://127.0.0.1:${address.port}`, requests, env)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

test('session send keeps the message positional when routing flags appear before or after it', async () => {
  await withBackend(async (api, requests, env) => {
    for (const args of [
      ['session', 'send', TARGET, 'message before flag', '--api', api],
      ['session', 'send', TARGET, '--api', api, 'message after flag'],
      ['session', 'send', TARGET, '--api', api, '--', '--force'],
    ]) {
      const result = await runCli(args, env)
      assert.equal(result.code, 0, result.stderr)
      assert.equal(result.stdout, 'sent\n')
    }
    const posts = requests.filter((request) => request.method === 'POST')
    assert.deepEqual(posts.map((request) => request.body), [
      { kind: 'text', text: 'message before flag' },
      { kind: 'text', text: 'message after flag' },
      { kind: 'text', text: '--force' },
    ])
  })
})

test('session send rejects malformed valued flags and positional arity before backend contact', async () => {
  await withBackend(async (api, requests, env) => {
    const port = new URL(api).port
    for (const args of [
      ['session', 'send', TARGET, '--api', api],
      ['session', 'send', TARGET, 'one message', 'second message', '--api', api],
      ['session', 'send', TARGET, 'message', '--api', api, '--api', api],
      ['session', 'send', TARGET, 'message', '--port', port, '--port', port],
      ['session', 'send', TARGET, '--api', api, '--keys', 'Up', '--keys', 'Enter'],
      ['session', 'send', TARGET, 'message', '--api', ''],
      ['session', 'send', TARGET, 'message', '--api', api, '--port', ''],
      ['session', 'send', TARGET, '--api', api, '--keys', ''],
    ]) {
      const result = await runCli(args, env)
      assert.equal(result.code, 2)
      assert.equal(result.stdout, '')
      assert.doesNotMatch(result.stdout + result.stderr, /^sent$/m)
    }
    assert.deepEqual(requests, [], 'invalid argv must not reach the backend')
  })
})

test('session send rejects unknown flags before session resolution or dispatch', async () => {
  await withBackend(async (api, requests, env) => {
    const result = await runCli(['session', 'send', TARGET, '--bogus', '--api', api, 'do not send'], env)
    assert.equal(result.code, 2)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, 'spex session send: unknown flag --bogus\n')
    assert.deepEqual(requests, [], 'unknown flags must not reach the backend')
  })
})

test('session send requires -- to disambiguate a single-token option-shaped message', async () => {
  await withBackend(async (api, requests, env) => {
    const result = await runCli(['session', 'send', TARGET, '--force', '--api', api], env)
    assert.equal(result.code, 2)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, 'spex session send: unknown flag --force\n')
    assert.deepEqual(requests, [], 'an ambiguous option token must not reach the backend')
  })
})

test('session send preserves the mutually exclusive raw-key face', async () => {
  await withBackend(async (api, requests, env) => {
    const result = await runCli(['session', 'send', TARGET, '--api', api, '--keys', 'Up Enter'], env)
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stdout, `sent 2 keys -> ${TARGET}\n`)
    const posts = requests.filter((request) => request.method === 'POST')
    assert.deepEqual(posts.map((request) => request.body), [{ kind: 'keys', keys: ['Up', 'Enter'] }])
  })
})
