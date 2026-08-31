import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PiHeadlessController, deliverViaPiHeadless, piHeadlessColdRuntime, piHeadlessSock } from './pi-headless.js'
import { HARNESSES, piHarness, piHeadlessHarness } from './harness.js'

const waitFor = async (check: () => boolean, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for fixture state')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

test('pi-headless composes pi materialization and replaces only the runtime half', () => {
  assert.deepEqual(HARNESSES.map((h) => h.id), ['claude', 'codex', 'opencode', 'pi', 'zcode', 'claude-headless', 'opencode-headless', 'pi-headless', 'codex-headless'])
  const proj = '/tmp/project'
  assert.equal(piHeadlessHarness.shimFile(proj), piHarness.shimFile(proj))
  assert.deepEqual(piHeadlessHarness.contractFiles(proj), piHarness.contractFiles(proj))
  assert.equal(piHeadlessHarness.skillDir(proj), piHarness.skillDir(proj))
  assert.equal(piHeadlessHarness.agentDir(proj), piHarness.agentDir(proj))
  assert.equal(piHeadlessHarness.shim('/dispatch', '/spex').content, piHarness.shim('/dispatch', '/spex').content)
  assert.equal(piHeadlessHarness.sessionIdArg('abc'), '--session-id abc')
  assert.equal(piHeadlessHarness.resumeArg({ session: 'abc' }), '--session abc')
  assert.equal(piHeadlessHarness.headless, true)
  assert.equal(piHeadlessHarness.runtimeOwnership, 'leaf')
  assert.equal(piHeadlessHarness.ownsRendezvous, true)
  // Leaf-backed headless adapters share sessionHomeLiveness: the controller PID is the witness, and a
  // tmux pane that outlived a SIGKILL as a bare shell is not online. Same contract as claude-headless.
  assert.equal(piHeadlessHarness.liveness({ session: 'abc' }, true, undefined, { pidAlive: true }), 'online')
  assert.equal(piHeadlessHarness.liveness({ session: 'abc' }, true, undefined, { pidAlive: false }), 'offline')
  assert.equal(piHeadlessHarness.liveness({ session: 'abc' }, false), 'offline')
  assert.equal(piHeadlessHarness.liveness({ session: 'abc', stopped: true }, false), 'offline')
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
  const controller = new PiHeadlessController(id, runtime, cmd, process.cwd())
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

// [[dispatch]] hard interrupt for pi-headless: the controller aborts natively over the child's rendezvous
// socket and confirms only once that child has exited; a child that never reached its first agent event is
// still the controller's own process and is terminated as such; nothing running refuses loudly.
test('pi-headless interrupt aborts the running child through its rendezvous shim and confirms after the child exits', async (t) => {
  const { interruptPiHeadless } = await import('./pi-headless.js')
  const root = mkdtempSync(join(tmpdir(), 'spex-pi-headless-int-'))
  const runtime = join(root, 'runtime')
  const marks = join(root, 'marks.ndjson')
  const fake = join(root, 'fake-pi.mjs')
  // a pi stand-in: binds the rendezvous socket the launch env names, answers an interrupt line like the
  // generated extension does (runtime shim protocol), then exits 0 shortly after — pi's own aborted-turn shape
  writeFileSync(fake, `
import { appendFileSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:net'
const sock = process.env.CLAUDE_BG_RENDEZVOUS_SOCK
try { unlinkSync(sock) } catch {}
const server = createServer((c) => {
  let buf = ''
  c.on('data', (d) => {
    buf += d.toString('utf8')
    if (!buf.includes('\\n')) return
    if (buf.includes('"interrupt"')) {
      appendFileSync(${JSON.stringify(marks)}, 'aborted\\n')
      c.write(JSON.stringify({ type: 'interrupt-done' }) + '\\n')
      setTimeout(() => process.exit(0), 150)
    }
  })
})
server.listen(sock)
setTimeout(() => process.exit(0), 20000)
`)
  const id = `pi-headless-int-${process.pid}`
  const { rvSock } = await import('./harness.js')
  const previous = process.env.CLAUDE_BG_RENDEZVOUS_SOCK
  process.env.CLAUDE_BG_RENDEZVOUS_SOCK = rvSock(id)
  const controller = new PiHeadlessController(id, runtime, `${process.execPath} ${fake}`, process.cwd())
  t.after(async () => { await controller.close(); process.env.CLAUDE_BG_RENDEZVOUS_SOCK = previous; rmSync(root, { recursive: true, force: true }) })
  await controller.start('INITIAL')
  await waitFor(() => existsSync(rvSock(id)))
  const r = await interruptPiHeadless({ session: id })
  assert.deepEqual(r, { ok: true })
  assert.equal(readFileSync(marks, 'utf8'), 'aborted\n', 'the abort reached the child through the rendezvous shim')
  assert.equal(existsSync(rvSock(id)) && (await rvListener(rvSock(id))) === 'live', false, 'the interrupted child is gone when the interrupt is confirmed')
  const idle = await interruptPiHeadless({ session: id })
  assert.equal(idle.ok, false)
  assert.match(idle.error || '', /no pi-headless turn is running/)
})

test('pi-headless interrupt terminates a child that never reached its first agent event', async (t) => {
  const { interruptPiHeadless } = await import('./pi-headless.js')
  const root = mkdtempSync(join(tmpdir(), 'spex-pi-headless-int-'))
  const fake = join(root, 'fake-pi.mjs')
  writeFileSync(fake, `setTimeout(() => {}, 60000)\n`)   // a pi still booting: no rendezvous listener, no events
  const id = `pi-headless-boot-${process.pid}`
  const controller = new PiHeadlessController(id, join(root, 'runtime'), `${process.execPath} ${fake}`, process.cwd())
  t.after(async () => { await controller.close(); rmSync(root, { recursive: true, force: true }) })
  await controller.start('INITIAL')
  await new Promise((resolve) => setTimeout(resolve, 200))
  const r = await interruptPiHeadless({ session: id })
  assert.deepEqual(r, { ok: true }, 'the owned process was terminated as the fallback')
  const idle = await interruptPiHeadless({ session: id })
  assert.match(idle.error || '', /no pi-headless turn is running/)
})

async function rvListener(path: string): Promise<'live' | 'dead' | 'unproven'> {
  const { listenerAt } = await import('./harness.js')
  return listenerAt(path)
}

test('pi-headless cold proof accepts only dead controller and rendezvous listeners', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'spex-pi-headless-cold-proof-'))
  const id = `pi-headless-cold-proof-${process.pid}`
  const controller = new PiHeadlessController(id, join(root, 'runtime'), 'true', process.cwd())
  t.after(async () => {
    await controller.close()
    rmSync(root, { recursive: true, force: true })
  })
  await controller.start()
  const live = await piHeadlessColdRuntime({ session: id })
  assert.equal(live.ok, false, 'a listening controller cannot be filed as cold')
  await controller.close()
  assert.deepEqual(await piHeadlessColdRuntime({ session: id }), { ok: true })
})
