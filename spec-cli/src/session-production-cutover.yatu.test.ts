import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import net from 'node:net'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { migrateJsonSessionRecords, openProjectSessionApplication } from '@spexcode/session-application'

async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return address.port
}

async function stop(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return
  process.kill('SIGTERM')
  await Promise.race([once(process, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))])
  if (process.exitCode === null) process.kill('SIGKILL')
}

test('YATU cutover matrix: ten distinct stories through the backend HTTP and migration CLI surfaces', { timeout: 180_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-session-cutover-http-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const bin = join(fixture, 'bin')
  const databasePath = join(home, 'sessions.sqlite')
  const port = await freePort()
  mkdirSync(join(project, '.spec', 'project'), { recursive: true }); mkdirSync(home); mkdirSync(bin)
  writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: fixture\nstatus: active\n---\n# fixture\n')
  writeFileSync(join(project, '.spec/spexcode.json'), '{"harnesses":["claude"]}\n')
  writeFileSync(join(bin, 'tmux'), '#!/bin/sh\n[ "$1" = "-V" ] && { echo "tmux 3.4"; exit 0; }\nexit 1\n'); chmodSync(join(bin, 'tmux'), 0o755)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project }); execFileSync('git', ['config', 'user.email', 'yatu@example.test'], { cwd: project }); execFileSync('git', ['config', 'user.name', 'YATU'], { cwd: project }); execFileSync('git', ['add', '.'], { cwd: project }); execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: project })
  // the test worker pins the canonical database beside its own home; this fixture owns a different home
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH || ''}`, SPEXCODE_HOME: home, SPEX_SESSION_DATABASE_PATH: databasePath, PORT: String(port) }
  const records = join(fixture, 'legacy')
  mkdirSync(join(records, 'migrated'), { recursive: true })
  writeFileSync(join(records, 'migrated', 'session.json'), JSON.stringify({ session_id: 'migrated', status: 'active', parent: null, createdAt: 1 }))
  const firstMigration = migrateJsonSessionRecords({ databasePath, recordsRoot: records, locality: () => {} })
  const secondMigration = migrateJsonSessionRecords({ databasePath, recordsRoot: records, locality: () => {} })
  assert.equal(firstMigration.replayed, false)
  assert.equal(secondMigration.replayed, true)
  const seed = openProjectSessionApplication({ databasePath, locality: () => {} })
  for (const id of ['parent', 'child', 'parent2', 'watch1', 'watch2', 'batch', 'batchw', 'pub', 'pubw', 'a', 'aw', 'b', 'bw']) seed.createSession({ sessionId: id })
  seed.transitionSession('child', { parentSessionId: 'parent' }); seed.close()
  let backend: ChildProcess | null = null
  let backendLog = ''
  const indexPath = join(process.cwd(), 'src/index.ts')
  const start = () => {
    backendLog = ''
    backend = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), indexPath], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] })
    backend.stdout?.on('data', chunk => { backendLog += String(chunk) }); backend.stderr?.on('data', chunk => { backendLog += String(chunk) })
    return backend
  }
  const waitForBackend = async (label: string): Promise<void> => {
    const deadline = Date.now() + 30_000
    for (;;) {
      if (backend?.exitCode !== null && backend?.exitCode !== undefined) {
        throw new Error(`${label}: backend exited before health (entry=${indexPath}, cwd=${project}, exit=${backend.exitCode}, signal=${backend.signalCode ?? 'none'}, output=${backendLog || '<empty>'})`)
      }
      if (await fetch(`${base}/health`).then(response => response.ok).catch(() => false)) return
      if (Date.now() > deadline) throw new Error(`${label}: backend health timeout (entry=${indexPath}, cwd=${project}, pid=${backend?.pid ?? 'none'}, exit=${backend?.exitCode ?? 'running'}, signal=${backend?.signalCode ?? 'none'}, output=${backendLog || '<empty>'})`)
      await new Promise(resolve => setTimeout(resolve, 40))
    }
  }
  const base = `http://127.0.0.1:${port}`
  const request = async (path: string, init?: RequestInit): Promise<any> => { const response = await fetch(base + path, init); const text = await response.text(); if (!response.ok) throw new Error(`${response.status}: ${text}`); return text ? JSON.parse(text) : null }
  const post = (path: string, body: unknown) => request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const results: Array<{ name: string; passed: boolean; error?: string }> = []
  const story = async (name: string, body: () => Promise<void>) => { try { await body(); results.push({ name, passed: true }) } catch (error) { results.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) }) } }
  try {
    start(); await waitForBackend('backend')
    await story('parent-child', async () => { const replay = await request('/api/session-runtime/child/replay'); assert.equal(replay.parentSessionId, 'parent') })
    await story('multiple-watchers', async () => { await post('/api/session-runtime/child/watch', { watcherSessionId: 'watch1' }); await post('/api/session-runtime/child/watch', { watcherSessionId: 'watch2' }) })
    await story('reparent', async () => { await post('/api/session-runtime/child/state', { parentSessionId: 'parent2', reason: 'http-reparent' }); assert.equal((await request('/api/session-runtime/child/replay')).parentSessionId, 'parent2') })
    await story('state-transition-replay', async () => { await post('/api/session-runtime/child/state', { status: 'active' }); await post('/api/session-runtime/child/state', { status: 'awaiting' }); assert.equal((await request('/api/session-runtime/child/replay')).status, 'awaiting') })
    await story('restart', async () => { await stop(backend!); start(); await waitForBackend('restart'); assert.equal((await request('/api/session-runtime/child/replay')).status, 'awaiting') })
    await story('generation-fencing', async () => { const first = await post('/api/session-runtime/watch1/bind', { namespace: 'spex-governed', runtimeKind: 'yatu', nativeSessionId: 'w1', nativeStartToken: 'one' }); await post('/api/session-runtime/watch1/bind', { namespace: 'spex-governed', runtimeKind: 'yatu', nativeSessionId: 'w1', nativeStartToken: 'two', expectedGeneration: first.bindingGeneration }); await assert.rejects(() => post('/api/session-runtime/watch1/bind', { namespace: 'spex-governed', runtimeKind: 'yatu', nativeSessionId: 'w1', nativeStartToken: 'three', expectedGeneration: first.bindingGeneration })) })
    await story('ordered-batch-delivery', async () => { await post('/api/session-runtime/batch/watch', { watcherSessionId: 'batchw' }); await post('/api/session-runtime/batch/state', { status: 'active' }); await post('/api/session-runtime/batch/state', { status: 'awaiting' }); await post('/api/session-runtime/batchw/bind', { namespace: 'spex-governed', runtimeKind: 'yatu', nativeSessionId: 'batchw', nativeStartToken: 'one' }); const one = await post('/api/session-runtime/batchw/dequeue', { namespace: 'spex-governed' }); const two = await post('/api/session-runtime/batchw/dequeue', { namespace: 'spex-governed' }); assert.ok(one.enqueueSeq < two.enqueueSeq) })
    await story('publish-before-after-watch', async () => { await post('/api/session-runtime/pub/publish', { kind: 'before', body: 'before' }); await post('/api/session-runtime/pub/watch', { watcherSessionId: 'pubw' }); await post('/api/session-runtime/pub/publish', { kind: 'after', body: 'after' }); await post('/api/session-runtime/pubw/bind', { namespace: 'spex-governed', runtimeKind: 'yatu', nativeSessionId: 'pubw', nativeStartToken: 'one' }); const message = await post('/api/session-runtime/pubw/dequeue', { namespace: 'spex-governed' }); assert.equal(message.kind, 'after') })
    await story('independent-session-pairs', async () => { await post('/api/session-runtime/a/watch', { watcherSessionId: 'aw' }); await post('/api/session-runtime/b/watch', { watcherSessionId: 'bw' }); await post('/api/session-runtime/a/publish', { kind: 'pair-a', body: 'a' }); await post('/api/session-runtime/aw/bind', { namespace: 'spex-governed', runtimeKind: 'yatu', nativeSessionId: 'aw', nativeStartToken: 'one' }); const message = await post('/api/session-runtime/aw/dequeue', { namespace: 'spex-governed' }); assert.equal(message.kind, 'pair-a') })
    await story('one-time-migration-marker', async () => {
      assert.equal(secondMigration.markerPath, join(home, 'sessions.sqlite.json-migration.json'))
      assert.equal(secondMigration.backupRoot, join(home, 'sessions.sqlite.json-migration-backup'))
      const replay = await request('/api/session-runtime/migrated/replay')
      assert.deepEqual(replay, { sessionId: 'migrated', status: 'active', proposal: null, note: null, parentSessionId: null, updatedAtMs: 1 })
      const events = await request('/api/session-runtime/migrated/events')
      assert.equal(events.length, 1)
      assert.equal(events[0].type, 'session.state.changed.v1')
    })
    console.log(JSON.stringify({ scenarios: results, passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length }, null, 2))
    assert.equal(results.length, 10); assert.equal(results.filter(result => !result.passed).length, 0)
  } finally { if (backend) await stop(backend) }
})
