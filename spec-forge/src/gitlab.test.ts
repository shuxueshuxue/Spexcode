import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ForgeCache } from './cache.js'

const rows = Array.from({ length: 7 }, (_, index) => ({
  iid: index + 1,
  title: `fixture issue ${index + 1}`,
  description: '',
  web_url: `http://fixture.test/group/adopter-a/-/issues/${index + 1}`,
  state: 'opened',
  labels: [],
  author: { username: 'fixture' },
  created_at: '2026-07-30T00:00:00.000Z',
  user_notes_count: 0,
}))
const paths: string[] = []
const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://fixture.test')
  paths.push(url.pathname)
  if (request.headers['private-token'] !== 'fixture-token') { response.writeHead(401).end(); return }
  if (url.pathname.endsWith('/issues')) { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(rows)); return }
  if (url.pathname.endsWith('/merge_requests')) { response.writeHead(200, { 'content-type': 'application/json' }).end('[]'); return }
  response.writeHead(404).end()
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port
const bin = mkdtempSync(join(tmpdir(), 'spex-gitlab-driver-'))
const git = join(bin, 'git')
const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
writeFileSync(git, `#!/bin/sh
if [ "$1" = "remote" ] && [ "$2" = "get-url" ] && [ "$3" = "origin" ]; then
  printf '%s\\n' 'http://127.0.0.1:${port}/group/adopter-a.git'
  exit 0
fi
exec '${realGit}' "$@"
`)
chmodSync(git, 0o700)
process.env.PATH = `${bin}:${process.env.PATH || ''}`
process.env.GITLAB_TOKEN = 'fixture-token'
const { gitlabDriver } = await import('./drivers/gitlab.js')

test('gitlab driver reconciles its live REST shape into a content-versioned cache', async (t) => {
  t.after(() => server.close())
  const cache = new ForgeCache()

  await cache.reconcile(gitlabDriver)
  assert.equal(cache.state().issues.length, 7)
  assert.deepEqual(new Set(cache.state().issues.map((issue) => issue.state)), new Set(['open']))
  assert.ok(paths.includes('/api/v4/projects/group%2Fadopter-a/issues'))
  const seeded = cache.stateRevision()

  await cache.reconcile(gitlabDriver)
  assert.equal(cache.stateRevision(), seeded)

  rows[0] = { ...rows[0], title: 'fixture issue changed' }
  await cache.reconcile(gitlabDriver)
  assert.equal(cache.stateRevision(), seeded + 1)
})
