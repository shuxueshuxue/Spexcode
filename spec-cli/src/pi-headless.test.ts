import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PiHeadlessController, deliverViaPiHeadless, piHeadlessSock } from './pi-headless.js'
import { HARNESSES, piHarness, piHeadlessHarness } from './harness.js'

const waitFor = async (check: () => boolean, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for fixture state')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

test('pi-headless composes pi materialization and replaces only the runtime half', () => {
  assert.deepEqual(HARNESSES.map((h) => h.id), ['claude', 'codex', 'opencode', 'pi', 'claude-headless', 'pi-headless'])
  const proj = '/tmp/project'
  assert.equal(piHeadlessHarness.shimFile(proj), piHarness.shimFile(proj))
  assert.deepEqual(piHeadlessHarness.contractFiles(proj), piHarness.contractFiles(proj))
  assert.equal(piHeadlessHarness.skillDir(proj), piHarness.skillDir(proj))
  assert.equal(piHeadlessHarness.agentDir(proj), piHarness.agentDir(proj))
  assert.equal(piHeadlessHarness.shim('/dispatch', '/spex').content, piHarness.shim('/dispatch', '/spex').content)
  assert.equal(piHeadlessHarness.sessionIdArg('abc'), '--session-id abc')
  assert.equal(piHeadlessHarness.resumeArg({ session: 'abc' }), '--session abc')
  assert.equal(piHeadlessHarness.headless, true)
  assert.equal(piHeadlessHarness.messageStream, false)
  assert.equal(piHeadlessHarness.ownsRendezvous, true)
  assert.equal(piHeadlessHarness.liveness({ session: 'abc' }, false), 'online')
  assert.match(piHeadlessHarness.launchCmd('abc', '/runtime', 'pi-custom'), /pi-headless-run.*abc.*pi-custom/)
})

test('pi-headless cold delivery resumes the exact saved session in text mode', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'spex-pi-headless-test-'))
  const runtime = join(root, 'runtime')
  const invocations = join(root, 'invocations.ndjson')
  const fake = join(root, 'fake-pi.mjs')
  writeFileSync(fake, `
import { appendFileSync } from 'node:fs'
appendFileSync(${JSON.stringify(invocations)}, JSON.stringify(process.argv.slice(2)) + '\\n')
process.stdout.write('pi fixture\\n')
`)
  const id = `pi-headless-${process.pid}`
  const cmd = `${process.execPath} ${fake}`
  const controller = new PiHeadlessController(id, runtime, cmd, root)
  t.after(() => controller.close())
  await controller.start('INITIAL')
  await waitFor(() => existsSync(invocations))
  const cold = await deliverViaPiHeadless({ session: id }, 'WAKE')
  assert.deepEqual(cold, { ok: true })
  await waitFor(() => readFileSync(invocations, 'utf8').trim().split('\n').length === 2)
  const args = readFileSync(invocations, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[])
  assert.deepEqual(args[0].slice(0, 3), ['-p', '--session-id', id])
  assert.deepEqual(args[1].slice(0, 3), ['-p', '--session', id])
  assert.equal(args.some((argv) => argv.includes('--mode')), false, 'controller keeps pi in default text mode')
  assert.equal(existsSync(piHeadlessSock(id)), true)
})

