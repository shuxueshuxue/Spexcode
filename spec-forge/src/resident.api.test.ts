import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { tsxBin } from '../../spec-cli/src/tsx-bin.js'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

async function waitForHealth(port: number): Promise<void> {
  for (let tries = 0; tries < 200; tries++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return
    } catch {}
    await delay(25)
  }
  throw new Error('branch-local backend did not become healthy')
}

test('resident GitLab reconcile republishes the branch-local Issues API after a late response', async (t) => {
  const project = mkdtempSync(join(tmpdir(), 'spex-forge-api-project-'))
  const home = mkdtempSync(join(tmpdir(), 'spex-forge-api-home-'))
  const bin = mkdtempSync(join(tmpdir(), 'spex-forge-api-bin-'))
  const runGit = (...args: string[]) => execFileSync(realGit, ['-C', project, ...args], { encoding: 'utf8' })
  runGit('init', '-q', '-b', 'main')
  runGit('config', 'user.email', 'fixture@example.test')
  runGit('config', 'user.name', 'fixture')
  mkdirSync(join(project, '.spec', 'fixture'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), '---\ntitle: fixture\nstatus: active\n---\n\nfixture\n')
  runGit('add', '-A')
  runGit('commit', '-qm', 'fixture')

  const rows = Array.from({ length: 7 }, (_, index) => ({
    iid: index + 1,
    title: `fixture issue ${index + 1}`,
    description: '',
    web_url: `http://fixture.test/group/z-code/-/issues/${index + 1}`,
    state: 'opened',
    labels: [],
    author: { username: 'fixture' },
    created_at: '2026-07-30T00:00:00.000Z',
    user_notes_count: 0,
  }))
  let requestFirstIssues!: () => void
  const firstIssuesRequested = new Promise<void>((resolve) => { requestFirstIssues = resolve })
  let releaseFirstIssues!: () => void
  let issueRequests = 0
  const upstream = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://fixture.test')
    if (request.headers['private-token'] !== 'fixture-token') { response.writeHead(401).end(); return }
    if (url.pathname.endsWith('/issues')) {
      const respond = () => response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(rows))
      if (issueRequests++ === 0) {
        requestFirstIssues()
        let released = false
        releaseFirstIssues = () => {
          if (released) return
          released = true
          respond()
        }
      } else respond()
      return
    }
    if (url.pathname.endsWith('/merge_requests')) { response.writeHead(200, { 'content-type': 'application/json' }).end('[]'); return }
    response.writeHead(404).end()
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const upstreamPort = (upstream.address() as { port: number }).port
  const git = join(bin, 'git')
  writeFileSync(git, `#!/bin/sh
if [ "$1" = "remote" ] && [ "$2" = "get-url" ] && [ "$3" = "origin" ]; then
  printf '%s\\n' 'http://127.0.0.1:${upstreamPort}/group/z-code.git'
  exit 0
fi
exec '${realGit}' "$@"
`)
  chmodSync(git, 0o700)

  const port = await freePort()
  const backend = spawn(process.execPath, [tsxBin(join(root, 'spec-cli')), join(root, 'spec-cli', 'src', 'index.ts')], {
    cwd: project,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH || ''}`,
      PORT: String(port),
      GITLAB_TOKEN: 'fixture-token',
      SPEXCODE_HOME: home,
      SPEXCODE_TMUX: 'spex-forge-api-fixture',
    },
    stdio: 'ignore',
  })
  t.after(async () => {
    releaseFirstIssues?.()
    backend.kill('SIGTERM')
    if (backend.exitCode === null) await once(backend, 'exit')
    upstream.closeAllConnections?.()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
    rmSync(project, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
    rmSync(bin, { recursive: true, force: true })
  })

  await waitForHealth(port)
  const endpoint = `http://127.0.0.1:${port}/api/issues?q=store%3Agitlab%20state%3Aopen&page=1`
  const first = fetch(endpoint).then(async (response) => {
    assert.equal(response.status, 200)
    return response.json() as Promise<{ total: number; items: { id: string }[] }>
  })
  await firstIssuesRequested
  const before = await first
  assert.equal(before.total, 0)

  releaseFirstIssues()
  let after: { total: number; items: { id: string }[] } | null = null
  for (let tries = 0; tries < 200; tries++) {
    const response = await fetch(endpoint)
    assert.equal(response.status, 200)
    const page = await response.json() as { total: number; items: { id: string }[] }
    if (page.total === 7) { after = page; break }
    await delay(25)
  }
  assert.ok(after, 'the second product read did not republish the resident GitLab slice')
  assert.deepEqual(after.items.map((issue) => issue.id), Array.from({ length: 7 }, (_, index) => `gitlab#${index + 1}`))
})
