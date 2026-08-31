import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const tsxCli = join(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist', 'cli.mjs')
const WATCH_PARENT = 'create-watch-parent'
const WATCH_CHILD = 'create-watch-child'

test('every allowed flag read as a value is declared to the positional scanner', () => {
  const source = readFileSync(cli, 'utf8')
  const file = ts.createSourceFile(cli, source, ts.ScriptTarget.Latest, true)
  const valueFlags = new Set<string>()
  const valueReads = new Set<string>()
  const allowedFlags = new Set<string>()
  let foundValueFlags = false
  let rejectUnknownCalls = 0

  const strings = (node: ts.Expression | undefined): string[] | null => {
    if (!node || !ts.isArrayLiteralExpression(node)) return null
    const names: string[] = []
    for (const element of node.elements) {
      if (!ts.isStringLiteral(element)) return null
      names.push(element.text)
    }
    return names
  }

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'VALUE_FLAGS' &&
      node.initializer && ts.isNewExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'Set') {
      const names = strings(node.initializer.arguments?.[0])
      assert.ok(names, 'VALUE_FLAGS must be a literal string array')
      for (const name of names) valueFlags.add(name)
      foundValueFlags = true
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'flag' && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
        valueReads.add(node.arguments[0].text)
      }
      if (node.expression.text === 'rejectUnknownFlags' || node.expression.text === 'rejectUnknownBackendFlags') {
        rejectUnknownCalls++
        const names = strings(node.arguments[2])
        assert.ok(names, `${node.expression.text} allowlists must be literal string arrays`)
        for (const name of names) allowedFlags.add(name)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)

  assert.ok(foundValueFlags, 'VALUE_FLAGS declaration found')
  assert.ok(rejectUnknownCalls > 0, 'rejectUnknownFlags calls found')
  const missing = [...allowedFlags]
    .filter((name) => valueReads.has(name) && !valueFlags.has(`--${name}`))
    .sort()
  assert.deepEqual(missing, [], 'every allowed flag read by flag(name) must consume its argv value')
})

test('session new keeps name and base values out of positional prompt intake', () => {
  const promptFile = join(tmpdir(), `spex-missing-prompt-${process.pid}`)
  for (const [flag, value] of [['--name', 'spaced session name'], ['--base', 'no-such-commit']]) {
    const r = spawnSync('tsx', [cli, 'session', 'new', '--prompt-file', promptFile, flag, value], {
      cwd: pkgRoot,
      encoding: 'utf8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    })
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, new RegExp(`^spex session new: --prompt-file ${promptFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`))
    assert.doesNotMatch(r.stderr, /give the prompt either inline or via --prompt-file, not both/)
  }
})

function writeGovernedSession(home: string, id: string, parent = ''): string {
  const project = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: pkgRoot, encoding: 'utf8' }).trim())
  const dir = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.json'), JSON.stringify({
    session_id: id, governed: true, worktree_path: pkgRoot, branch: `node/${id}`, node: 'session-follow',
    title: id, name: '', parent, status: 'active', proposal: '', merges: 0, note: '', sortkey: '', createdAt: Date.now(),
    harness: 'opencode', harness_session_id: '', stopped: false, archived: false, launcher: 'fixture', launch_cmd: 'true', launch_owner: '',
  }, null, 2) + '\n')
  return dir
}


async function runCreate(project: string, env: NodeJS.ProcessEnv, api?: string) {
  const child = spawn(process.execPath, [tsxCli, cli, 'session', 'new', 'probe', ...(api ? ['--api', api] : [])], {
    cwd: project,
    env: { ...env, NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  let killed = false
  const timer = setTimeout(() => { killed = true; child.kill('SIGKILL') }, 6_000)
  const [code] = await once(child, 'close') as [number | null]
  clearTimeout(timer)
  return { code, stdout, stderr, killed }
}

test('session new rejects stale mode flags through the generic unknown-flag path', () => {
  for (const args of [['--mode', 'headless'], ['--headless']]) {
    const flag = args[0]
    const r = spawnSync('tsx', [cli, 'session', 'new', 'probe', ...args], { cwd: pkgRoot, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } })
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
    assert.equal(r.stderr, `spex session new: unknown flag ${flag}\n`)
  }
})

test('session new retires the out-of-band --node binding before launch', () => {
  const r = spawnSync('tsx', [cli, 'session', 'new', 'probe', '--node', 'launch'], {
    cwd: pkgRoot,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  })
  assert.equal(r.status, 2)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr, 'spex session new: --node was removed — put a [[<id>]] mention in the prompt — the first mention binds\n')
})

test('session new keeps exact JSON stdout and emits the dependency receipt on stderr', async () => {
  let posted: unknown = null
  const server = createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/api/instance' || req.url === '/api/settings')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      posted = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      res.writeHead(201, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'created-1' }))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: '1' }
  for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete env[key]
  env.SPEXCODE_API_URL = ''

  const child = spawn('tsx', [cli, 'session', 'new', '[[launch]] ordinary task', '--launcher', 'claude', '--name', 'launch label', '--api', `http://127.0.0.1:${address.port}`], {
    cwd: pkgRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  const [code] = await once(child, 'close') as [number]
  server.close()
  await once(server, 'close')

  assert.equal(code, 0, stderr)
  assert.deepEqual(posted, { prompt: '[[launch]] ordinary task', parent: null, launcher: 'claude', name: 'launch label' })
  assert.equal(stdout, '{\n  "id": "created-1"\n}\n')
  assert.equal(stderr, `spex: launched session created-1
  current result: the session JSON is on stdout now; \`spex session ls created-1\` is the later one-shot snapshot
  next lifecycle change: background \`spex session wait created-1\` (edge-triggered; exits on the next non-actionable→actionable transition); \`spex session watch created-1\` registers send-backed delivery when the caller is governed; \`spex session watch stream created-1\` NEVER EXITS
  response channel: \`spex session send created-1 "<msg>"\`; \`send --keys\` is an UNSTABLE LAST RESORT after a plain send cannot land
`)
  assert.doesNotMatch(stdout, /current result|next lifecycle change|response channel/)
})

test('session new from a governed parent establishes its child watch before printing the receipt', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-create-watch-'))
  writeGovernedSession(home, WATCH_PARENT)
  const childDir = writeGovernedSession(home, WATCH_CHILD, WATCH_PARENT)
  let posted: any = null
  const server = createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/api/instance' || req.url === '/api/settings')) {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return
    }
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      posted = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      res.writeHead(201, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: WATCH_CHILD, parent: WATCH_PARENT }))
    })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address === 'object')
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: '1', SPEXCODE_HOME: home, SPEXCODE_SESSION_ID: WATCH_PARENT, SPEXCODE_API_URL: '' }
  for (const key of ['CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete env[key]
  const child = spawn(process.execPath, [tsxCli, cli, 'session', 'new', 'watch me', '--api', `http://127.0.0.1:${address.port}`], {
    cwd: pkgRoot, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  const [code] = await once(child, 'close') as [number]
  server.close(); await once(server, 'close')

  assert.equal(code, 0, stderr)
  assert.equal(posted.parent, WATCH_PARENT)
  assert.match(stdout, new RegExp(WATCH_CHILD))
  assert.match(stderr, /managed watch registered/)
  assert.equal(existsSync(join(childDir, 'watchers.json')), false, 'parent watch is canonical topology, not a JSON projection')
})

test('session new uses lightweight instance authority and falls back only for explicit connection refusal', { timeout: 20_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-create-dispatch-'))
  const projectPath = join(root, 'project'); mkdirSync(projectPath)
  const project = realpathSync(projectPath), home = join(root, 'home'), bin = join(root, 'bin')
  const linked = join(root, 'linked'), configuredMain = join(root, 'configured-main'), foreign = join(root, 'foreign')
  const tmuxTrace = join(root, 'tmux.trace'), dnsTrace = join(root, 'dns.trace'), dnsFailure = join(root, 'dns-failure.cjs')
  mkdirSync(bin)
  writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$SPEXCODE_TMUX_TRACE"\nexit 0\n'); chmodSync(join(bin, 'tmux'), 0o755)
  writeFileSync(dnsFailure, `
const dns = require('node:dns')
const fs = require('node:fs')
const lookup = dns.lookup
dns.lookup = function (hostname, options, callback) {
  if (hostname !== 'authority-dns.test') return lookup.call(this, hostname, options, callback)
  const done = typeof options === 'function' ? options : callback
  fs.appendFileSync(process.env.SPEXCODE_DNS_FAILURE_TRACE, 'lookup\\n')
  const error = Object.assign(new Error('getaddrinfo ENOTFOUND authority-dns.test'), { code: 'ENOTFOUND', hostname })
  process.nextTick(() => done(error))
}
`)
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=create-dispatch', '-c', 'user.email=create@example.test', 'add', '.'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=create-dispatch', '-c', 'user.email=create@example.test', 'commit', '-qm', 'fixture'], { cwd: project })
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'linked', linked, 'main'], { cwd: project })
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'configured-main', configuredMain, 'main'], { cwd: project })
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ main: configuredMain }))
  mkdirSync(foreign)
  writeFileSync(join(foreign, 'README.md'), 'foreign\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: foreign })
  execFileSync('git', ['-c', 'user.name=create-dispatch', '-c', 'user.email=create@example.test', 'add', '.'], { cwd: foreign })
  execFileSync('git', ['-c', 'user.name=create-dispatch', '-c', 'user.email=create@example.test', 'commit', '-qm', 'foreign fixture'], { cwd: foreign })

  const runtime = join(home, 'projects', project.replace(/[/.]/g, '-'))
  mkdirSync(runtime, { recursive: true })
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    SPEXCODE_HOME: home,
    SPEXCODE_TMUX: `create-dispatch-${process.pid}`,
    SPEXCODE_TMUX_TRACE: tmuxTrace,
    SPEXCODE_API_URL: '',
  }
  for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete env[key]
  const noArtifacts = () => {
    assert.equal(execFileSync('git', ['branch', '--list', 'node/*'], { cwd: project, encoding: 'utf8' }).trim(), '')
    assert.equal(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: project, encoding: 'utf8' }).match(/^worktree /gm)?.length, 3)
    assert.ok(!existsSync(join(runtime, 'sessions')) || readdirSync(join(runtime, 'sessions')).length === 0)
    assert.equal(existsSync(tmuxTrace) ? readFileSync(tmuxTrace, 'utf8') : '', '', 'the authority probe never creates a tmux artifact')
  }

  try {
    let linkedInstances = 0, linkedSettings = 0, linkedCreates = 0
    const linkedBackend = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/instance') {
        linkedInstances++
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ root: linked }))
        return
      }
      if (req.method === 'POST' && req.url === '/api/sessions') {
        linkedCreates++
        res.writeHead(201, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ id: 'linked-instance-1' }))
        return
      }
      if (req.method === 'GET' && req.url === '/api/settings') { linkedSettings++; return }
      res.writeHead(404); res.end()
    })
    linkedBackend.listen(0, '127.0.0.1'); await once(linkedBackend, 'listening')
    const linkedAddress = linkedBackend.address(); assert.ok(linkedAddress && typeof linkedAddress === 'object')
    const linkedResult = await runCreate(project, { ...env, SPEXCODE_API_URL: `http://127.0.0.1:${linkedAddress.port}` })
    linkedBackend.close(); await once(linkedBackend, 'close')
    assert.equal(linkedResult.code, 0, linkedResult.stderr)
    assert.match(linkedResult.stdout, /"id": "linked-instance-1"/)
    assert.equal(linkedInstances, 1, 'the linked backend receives one instance authority probe')
    assert.equal(linkedSettings, 0, 'settings never participates in creation authority')
    assert.equal(linkedCreates, 1, 'the matching backend receives one keyed create without a local duplicate')
    noArtifacts()

    for (const status of [404, 503]) {
      let instanceRequests = 0
      let settingsRequests = 0
      let createRequests = 0
      const server = createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/api/instance') instanceRequests++
        if (req.method === 'GET' && req.url === '/api/settings') settingsRequests++
        if (req.method === 'POST' && req.url === '/api/sessions') createRequests++
        res.writeHead(status); res.end('owned failure')
      })
      server.listen(0, '127.0.0.1'); await once(server, 'listening')
      const address = server.address(); assert.ok(address && typeof address === 'object')
      const result = await runCreate(project, { ...env, SPEXCODE_API_URL: `http://127.0.0.1:${address.port}` })
      server.close(); await once(server, 'close')
      assert.equal(result.code, 1)
      assert.match(result.stderr, new RegExp(`backend rejected session \\(${status}\\)`))
      assert.doesNotMatch(result.stderr, /launching in-process/)
      assert.equal(instanceRequests, 1, 'the HTTP target receives one instance authority probe')
      assert.equal(settingsRequests, 0, 'HTTP ownership does not consult settings')
      assert.equal(createRequests, 1, 'the HTTP target owns the one create attempt')
      noArtifacts()
    }

    let slowInstances = 0, slowSettings = 0, slowCreates = 0
    const slow = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/instance') {
        slowInstances++
        setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ root: linked })) }, 1_700)
        return
      }
      if (req.method === 'GET' && req.url === '/api/settings') { slowSettings++; res.writeHead(200); res.end('{}'); return }
      if (req.method === 'POST' && req.url === '/api/sessions') { slowCreates++; res.writeHead(201); res.end(JSON.stringify({ id: 'wrong' })); return }
      res.writeHead(404); res.end()
    })
    slow.listen(0, '127.0.0.1'); await once(slow, 'listening')
    const slowAddress = slow.address(); assert.ok(slowAddress && typeof slowAddress === 'object')
    const started = Date.now()
    const stalled = await runCreate(project, env, `http://127.0.0.1:${slowAddress.port}`)
    slow.close(); await once(slow, 'close')
    assert.equal(stalled.code, 0, stalled.stderr)
    assert.match(stalled.stdout, /"id": "wrong"/)
    assert.doesNotMatch(stalled.stderr, /launching in-process/)
    assert.equal(slowInstances, 1, 'the slow instance route is the sole authority probe')
    assert.equal(slowSettings, 0, 'a slow instance does not fall through to settings')
    assert.equal(slowCreates, 1, 'a slow instance still admits the backend-owned create request')
    assert.ok(Date.now() - started >= 1_600)
    assert.ok(Date.now() - started < 8_000)
    noArtifacts()

    let resetInstances = 0, resetSettings = 0, resetCreates = 0
    const reset = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/instance') {
        resetInstances++
        req.socket.destroy()
        return
      }
      if (req.method === 'GET' && req.url === '/api/settings') resetSettings++
      if (req.method === 'POST' && req.url === '/api/sessions') resetCreates++
      res.writeHead(500); res.end()
    })
    reset.listen(0, '127.0.0.1'); await once(reset, 'listening')
    const resetAddress = reset.address(); assert.ok(resetAddress && typeof resetAddress === 'object')
    const resetResult = await runCreate(project, env, `http://127.0.0.1:${resetAddress.port}`)
    reset.close(); await once(reset, 'close')
    assert.equal(resetResult.code, 1)
    assert.match(resetResult.stderr, /backend authority read failed after connection/)
    assert.doesNotMatch(resetResult.stderr, /launching in-process/)
    assert.equal(resetInstances, 1, 'a reset is observed at the instance authority seam')
    assert.equal(resetSettings, 0, 'a reset never retries through settings')
    assert.equal(resetCreates, 0, 'a reset never sends a create request')
    noArtifacts()

    let dnsInstances = 0, dnsSettings = 0, dnsCreates = 0
    const dns = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/instance') dnsInstances++
      if (req.method === 'GET' && req.url === '/api/settings') dnsSettings++
      if (req.method === 'POST' && req.url === '/api/sessions') dnsCreates++
      res.writeHead(500); res.end()
    })
    dns.listen(0, '127.0.0.1'); await once(dns, 'listening')
    const dnsAddress = dns.address(); assert.ok(dnsAddress && typeof dnsAddress === 'object')
    const dnsResult = await runCreate(project, {
      ...env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require=${dnsFailure}`,
      SPEXCODE_DNS_FAILURE_TRACE: dnsTrace,
    }, `http://authority-dns.test:${dnsAddress.port}`)
    dns.close(); await once(dns, 'close')
    assert.equal(dnsResult.code, 1)
    assert.match(dnsResult.stderr, /backend availability is indeterminate/)
    assert.doesNotMatch(dnsResult.stderr, /launching in-process/)
    assert.equal(readFileSync(dnsTrace, 'utf8'), 'lookup\n', 'the child reached the injected DNS failure')
    assert.equal(dnsInstances, 0, 'a DNS failure reaches no instance listener')
    assert.equal(dnsSettings, 0, 'a DNS failure never retries through settings')
    assert.equal(dnsCreates, 0, 'a DNS failure never sends a create request')
    noArtifacts()

    let mismatchInstances = 0, mismatchSettings = 0, mismatchCreates = 0
    const mismatch = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/instance') {
        mismatchInstances++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ root: foreign })); return
      }
      if (req.method === 'GET' && req.url === '/api/settings') { mismatchSettings++; return }
      if (req.method === 'POST' && req.url === '/api/sessions') { mismatchCreates++; res.writeHead(201); res.end(JSON.stringify({ id: 'explicit-foreign-1' })); return }
      res.writeHead(404); res.end()
    })
    mismatch.listen(0, '127.0.0.1'); await once(mismatch, 'listening')
    const mismatchAddress = mismatch.address(); assert.ok(mismatchAddress && typeof mismatchAddress === 'object')
    const mismatchUrl = `http://127.0.0.1:${mismatchAddress.port}`
    const mismatchResult = await runCreate(project, { ...env, SPEXCODE_API_URL: mismatchUrl })
    assert.equal(mismatchResult.code, 1)
    assert.match(mismatchResult.stderr, /refusing WRITE .* backend at .* serves/)
    assert.equal(mismatchInstances, 1, 'implicit routing compares the instance identity')
    assert.equal(mismatchSettings, 0, 'implicit mismatch does not rebuild settings')
    assert.equal(mismatchCreates, 0, 'mismatched implicit target is refused before create')
    const explicitResult = await runCreate(project, env, mismatchUrl)
    mismatch.close(); await once(mismatch, 'close')
    assert.equal(explicitResult.code, 0, explicitResult.stderr)
    assert.match(explicitResult.stdout, /"id": "explicit-foreign-1"/)
    assert.equal(mismatchInstances, 2, 'explicit routing still proves the selected backend is live')
    assert.equal(mismatchCreates, 1, 'explicit routing skips only the project comparison')
    noArtifacts()

    let healthRequests = 0, timedInstances = 0, timedSettings = 0, timedCreates = 0
    const recorded = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        healthRequests++
        setTimeout(() => { res.writeHead(200); res.end('ok') }, 350)
        return
      }
      if (req.method === 'GET' && req.url === '/api/instance') {
        timedInstances++
        setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ root: linked })) }, 1_200)
        return
      }
      if (req.method === 'GET' && req.url === '/api/settings') { timedSettings++; return }
      if (req.method === 'POST' && req.url === '/api/sessions') { timedCreates++; res.writeHead(201); res.end(JSON.stringify({ id: 'recorded-1' })); return }
      res.writeHead(404); res.end()
    })
    recorded.listen(0, '127.0.0.1'); await once(recorded, 'listening')
    const recordedAddress = recorded.address(); assert.ok(recordedAddress && typeof recordedAddress === 'object')
    writeFileSync(join(runtime, 'backend.json'), JSON.stringify({ url: `http://127.0.0.1:${recordedAddress.port}` }))
    const recordedStarted = Date.now()
    const recordedResult = await runCreate(project, env)
    rmSync(join(runtime, 'backend.json'), { force: true })
    recorded.close(); await once(recorded, 'close')
    assert.equal(recordedResult.code, 0, recordedResult.stderr)
    assert.match(recordedResult.stdout, /"id": "recorded-1"/)
    assert.equal(healthRequests, 1, 'the recorded endpoint health read remains discovery only')
    assert.equal(timedInstances, 1, 'the instance probe receives its own full wall after health')
    assert.equal(timedSettings, 0, 'record discovery never layers settings onto authority')
    assert.equal(timedCreates, 1)
    assert.ok(Date.now() - recordedStarted >= 1_400, '350ms health plus 1200ms instance use independent walls')
    noArtifacts()

    const largeHome = join(root, 'large-home')
    const largeRuntime = join(largeHome, 'projects', project.replace(/[/.]/g, '-'), 'sessions')
    for (let i = 0; i < 256; i++) {
      const dir = join(largeRuntime, `fake-${String(i).padStart(4, '0')}`)
      mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'session.json'), '{}')
    }
    let largeInstances = 0, largeSettings = 0, largeCreates = 0
    const large = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/instance') { largeInstances++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ root: linked })); return }
      if (req.method === 'GET' && req.url === '/api/settings') { largeSettings++; return }
      if (req.method === 'POST' && req.url === '/api/sessions') { largeCreates++; res.writeHead(201); res.end(JSON.stringify({ id: 'large-store-1' })); return }
      res.writeHead(404); res.end()
    })
    large.listen(0, '127.0.0.1'); await once(large, 'listening')
    const largeAddress = large.address(); assert.ok(largeAddress && typeof largeAddress === 'object')
    const largeResult = await runCreate(project, { ...env, SPEXCODE_HOME: largeHome, SPEXCODE_API_URL: `http://127.0.0.1:${largeAddress.port}` })
    large.close(); await once(large, 'close')
    assert.equal(largeResult.code, 0, largeResult.stderr)
    assert.equal(largeInstances, 1)
    assert.equal(largeSettings, 0, 'a large session store never enters the authority probe')
    assert.equal(largeCreates, 1)
    assert.equal(readdirSync(largeRuntime).length, 256, 'remote creation adds no local session to the fake store')

    const absent = createServer()
    absent.listen(0, '127.0.0.1'); await once(absent, 'listening')
    const absentAddress = absent.address(); assert.ok(absentAddress && typeof absentAddress === 'object')
    const refusedPort = absentAddress.port
    absent.close(); await once(absent, 'close')
    const refused = await runCreate(project, env, `http://127.0.0.1:${refusedPort}`)
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /no backend reachable .* launching in-process/)
    // the fallback IS attempted, then settles on its own preflight: this fixture names no default launcher,
    // so creation aborts at launcher-resolution before any branch, worktree, or record exists.
    assert.match(refused.stderr, /session_create_failed: sessions\.defaultLauncher is required/)
    noArtifacts()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
