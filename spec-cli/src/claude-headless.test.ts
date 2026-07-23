import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeHeadlessController, claudeHeadlessSock, deliverViaClaudeHeadless, interruptClaudeHeadless } from './claude-headless.js'
import { claudeHarness, claudeHeadlessHarness, HARNESSES } from './harness.js'

const waitFor = async (check: () => boolean, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for fixture state')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

test('claude-headless is a fifth adapter with Claude materialization and a replaced runtime half', () => {
  assert.deepEqual(HARNESSES.map((h) => h.id), ['claude', 'codex', 'opencode', 'pi', 'claude-headless'])
  const proj = '/tmp/project'
  assert.equal(claudeHeadlessHarness.shimFile(proj), claudeHarness.shimFile(proj))
  assert.deepEqual(claudeHeadlessHarness.contractFiles(proj), claudeHarness.contractFiles(proj))
  assert.equal(claudeHeadlessHarness.skillDir(proj), claudeHarness.skillDir(proj))
  assert.equal(claudeHeadlessHarness.agentDir(proj), claudeHarness.agentDir(proj))
  assert.equal(claudeHeadlessHarness.shim('/dispatch', '/spex').content, claudeHarness.shim('/dispatch', '/spex').content)
  assert.equal(claudeHeadlessHarness.sessionIdArg('abc'), '--session-id abc')
  assert.equal(claudeHeadlessHarness.resumeArg({ session: 'abc' }), '--resume abc')
  assert.equal(claudeHeadlessHarness.headless, true)
  assert.equal(claudeHeadlessHarness.messageStream, true)
  assert.equal(claudeHarness.messageStream, false)
  assert.equal(claudeHeadlessHarness.ownsRendezvous, false)
  assert.equal(claudeHeadlessHarness.liveness({ session: 'abc' }, false), 'online')
  assert.match(claudeHeadlessHarness.launchCmd('abc', '/runtime', 'claude-custom'), /claude-headless-run.*abc.*claude-custom/)
  const cleanupId = `cleanup-${process.pid}`
  writeFileSync(claudeHeadlessSock(cleanupId), 'stale')
  claudeHeadlessHarness.cleanupRuntime({ session: cleanupId })
  assert.equal(existsSync(claudeHeadlessSock(cleanupId)), false, 'adapter teardown removes a stale control socket')
})

test('controller cold-resumes idle turns, steers the active child, confirms interrupt, and stores native lines', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'spex-headless-test-'))
  const runtime = join(root, 'runtime')
  const invocations = join(root, 'invocations.ndjson')
  const fake = join(root, 'fake-claude.mjs')
  writeFileSync(fake, `
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
const log = process.argv[2]
appendFileSync(log, JSON.stringify(process.argv.slice(3)) + '\\n')
const emit = (event) => process.stdout.write(JSON.stringify(event) + '\\n')
const textOf = (event) => event?.message?.content?.find?.((part) => part?.type === 'text')?.text || ''
createInterface({ input: process.stdin }).on('line', (line) => {
  const event = JSON.parse(line)
  if (event.type === 'control_request') {
    emit({ type: 'control_response', response: { subtype: 'success', request_id: event.request_id, response: { still_queued: [] } } })
    emit({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 'fixture' })
    return
  }
  const text = textOf(event)
  emit({ type: 'system', subtype: 'init', session_id: 'fixture' })
  if (text === 'HOLD' || text === 'INTERRUPT') return
  emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, session_id: 'fixture' })
  emit({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: 'fixture' })
})
`)
  const id = 'headless-fixture'
  const cmd = `${process.execPath} '${fake}' '${invocations}'`
  const controller = new ClaudeHeadlessController(id, runtime, cmd, root)
  t.after(() => controller.close())
  await controller.start('INITIAL')
  const messages = join(runtime, 'sessions', id, 'messages.ndjson')
  await waitFor(() => existsSync(messages) && readFileSync(messages, 'utf8').includes('INITIAL'))

  const idle = await deliverViaClaudeHeadless({ session: id }, 'HOLD')
  assert.deepEqual(idle, { ok: true })
  const beforeSteer = readFileSync(invocations, 'utf8').trim().split('\n').length
  const steer = await deliverViaClaudeHeadless({ session: id }, 'STEER')
  assert.deepEqual(steer, { ok: true })
  await waitFor(() => readFileSync(messages, 'utf8').includes('STEER'))
  assert.equal(readFileSync(invocations, 'utf8').trim().split('\n').length, beforeSteer, 'mid-turn delivery reused the live child')

  const active = await deliverViaClaudeHeadless({ session: id }, 'INTERRUPT')
  assert.deepEqual(active, { ok: true })
  const interrupted = await interruptClaudeHeadless({ session: id })
  assert.deepEqual(interrupted, { ok: true })
  await waitFor(() => readFileSync(messages, 'utf8').includes('control_response'))
  const after = await deliverViaClaudeHeadless({ session: id }, 'AFTER')
  assert.deepEqual(after, { ok: true })
  await waitFor(() => readFileSync(messages, 'utf8').includes('AFTER'))

  const args = readFileSync(invocations, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[])
  assert.ok(args[0].includes('--session-id') && args[0].includes(id), 'fresh turn pins the governed session id')
  assert.ok(args.slice(1).every((argv) => argv.includes('--resume') && argv.includes(id)), 'every idle wake cold-resumes the same conversation')
  assert.ok(args.every((argv) => argv.includes('-p') && argv.includes('stream-json') && argv.includes('--verbose')))

  const nativeEvents = readFileSync(messages, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.ok(nativeEvents.some((event) => event.type === 'control_response'))
  assert.ok(nativeEvents.every((event) => typeof event.type === 'string' && !('spexcode' in event)), 'messages are native Claude events with no wrapper')
})
