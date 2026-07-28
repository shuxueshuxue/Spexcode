import test from 'node:test'
import assert from 'node:assert/strict'
import { codexHeadlessLaunchCommand } from './codex-headless.js'
import { codexHarness, codexHeadlessHarness, HARNESSES } from './harness.js'

test('codex-headless composes Codex materialization and shared-runtime ownership without a TUI attach', () => {
  assert.deepEqual(HARNESSES.map((h) => h.id), [
    'claude', 'codex', 'opencode', 'pi',
    'claude-headless', 'opencode-headless', 'pi-headless', 'codex-headless',
  ])
  const proj = process.cwd()
  assert.equal(codexHeadlessHarness.shimFile(proj), codexHarness.shimFile(proj))
  assert.deepEqual(codexHeadlessHarness.contractFiles(proj), codexHarness.contractFiles(proj))
  assert.equal(codexHeadlessHarness.skillDir(proj), codexHarness.skillDir(proj))
  assert.equal(codexHeadlessHarness.agentDir(proj), codexHarness.agentDir(proj))
  assert.equal(codexHeadlessHarness.shim('/dispatch', '/spex').content, codexHarness.shim('/dispatch', '/spex').content)
  assert.equal(codexHeadlessHarness.sessionIdArg('abc'), '')
  assert.equal(codexHeadlessHarness.resumeArg({ session: 'abc', harnessSessionId: 'thread-1' }), '')
  assert.equal(codexHeadlessHarness.headless, true)
  assert.equal(codexHeadlessHarness.ownsRendezvous, false)
  assert.equal(codexHeadlessHarness.liveness({ session: 'abc' }, false), 'online')
  assert.equal(codexHeadlessHarness.liveness({ session: 'abc', stopped: true }, false), 'offline')
  assert.equal(typeof codexHeadlessHarness.launchReady, 'function')
  assert.equal(codexHeadlessHarness.deliver, codexHarness.deliver)
  assert.equal(codexHeadlessHarness.observeTurnFailures, codexHarness.observeTurnFailures)
  assert.equal(codexHeadlessHarness.sharedRuntimes, codexHarness.sharedRuntimes)
  const headlessRuntime = codexHeadlessHarness.sharedRuntimes?.('/tmp/runtime') ?? []
  const interactiveRuntime = codexHarness.sharedRuntimes?.('/tmp/runtime') ?? []
  const descriptorContract = (descriptor: (typeof headlessRuntime)[number]) => ({
    key: descriptor.key,
    label: descriptor.label,
    pidFile: descriptor.pidFile,
    isolationFile: descriptor.isolationFile,
    capabilities: {
      probe: typeof descriptor.probe,
      residency: typeof descriptor.residency,
      mutationGuard: typeof descriptor.mutationGuard,
    },
  })
  assert.deepEqual(headlessRuntime.map(descriptorContract), interactiveRuntime.map(descriptorContract))
  assert.deepEqual(headlessRuntime.map(descriptorContract), [{
    key: 'codex-app-server',
    label: 'Codex app-server',
    pidFile: '/tmp/runtime/codex-app-server.pid',
    isolationFile: '/tmp/runtime/codex-app-server.scope',
    capabilities: { probe: 'function', residency: 'function', mutationGuard: 'function' },
  }])
})

test('codex-headless launch starts the shared app-server and first turn, then exits without attaching a TUI', () => {
  const cmd = codexHeadlessLaunchCommand('session-1', 'codex --yolo', 'codex', '/tmp/spex-project')
  assert.match(cmd, /internal shared-runtime-spawn [^\n]* codex app-server --listen "unix:\/\/\$sock"/)
  assert.match(cmd, /internal codex-launch "\$sock" "\$PWD" "\$@"/)
  assert.match(cmd, /internal session-turn-fail.*codex-headless/, 'non-zero one-shot turns report through the shared outcome seam')
  assert.match(cmd, /elif \[ "\$#" -eq 0 \]; then/)
  assert.doesNotMatch(cmd, /exec codex --yolo --remote unix:\/\/"\$sock" resume "\$tid"/)
})
