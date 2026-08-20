import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { ProtocolError } from '@spexcode/session-protocol'
import type { Message, MessageInput, SessionProtocol } from '@spexcode/session-protocol'

import { runCli } from './cli.js'
import { LocalityError } from './locality.js'

const sampleMessage = (body = Buffer.from([0, 255, 65])): Message => ({
  enqueueSeq: 1,
  messageId: '0198-test-message',
  targetSessionId: 'target',
  senderSessionId: null,
  protocolVersion: 1,
  kind: 'example.v1',
  body,
  headers: {},
  idempotencyKey: null,
  payloadHash: 'ab'.repeat(32),
  enqueuedAtMs: 1,
  dequeuedAtMs: null,
})

const fakeProtocol = (overrides: Partial<SessionProtocol> = {}): SessionProtocol => ({
  databasePath: '/tmp/sessions.sqlite',
  readOnly: false,
  initialize: sessionId => ({ sessionId, createdAtMs: 1, retiredAtMs: null }),
  enqueue: () => sampleMessage(),
  dequeue: () => null,
  listPending: () => [],
  readMessages: () => [],
  retire: sessionId => ({ sessionId, createdAtMs: 1, retiredAtMs: 2 }),
  withTransaction: body => body({
    exec: () => ({ changes: 0, lastInsertRowid: 0 }),
    query: () => [],
    enqueue: () => sampleMessage(),
  }),
  dataVersion: () => 1,
  close: () => {},
  ...overrides,
})

const invoke = async (
  argv: readonly string[],
  overrides: {
    env?: Readonly<Record<string, string | undefined>>
    protocol?: SessionProtocol
    requireLocal?: (path: string, options: { assumeLocal?: boolean }) => string
    open?: (path: string) => SessionProtocol
  } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  let stdout = ''
  let stderr = ''
  const protocol = overrides.protocol ?? fakeProtocol()
  const exitCode = await runCli({
    argv,
    env: overrides.env ?? { SPEX_SESSION_DATABASE_PATH: '/tmp/sessions.sqlite' },
    stdout: text => { stdout += text },
    stderr: text => { stderr += text },
    dependencies: {
      requireLocal: overrides.requireLocal ?? (path => path),
      open: overrides.open ?? (() => protocol),
    },
  })
  return { exitCode, stdout, stderr }
}

test('unknown argv including --message-id exits 2 in the frozen stderr shape', async () => {
  const result = await invoke(['enqueue', '--session-id', 'target', '--kind', 'x', '--body', 'x', '--message-id', 'mine'])
  assert.equal(result.exitCode, 2)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, 'spex-session: USAGE: unknown option --message-id\n')
})

test('missing required argv and malformed headers exit 2', async () => {
  assert.equal((await invoke(['initialize'])).exitCode, 2)
  assert.equal((await invoke(['enqueue', '--session-id', 'target', '--kind', 'x', '--body', 'x', '--header', 'broken'])).exitCode, 2)
})

test('enqueue encodes UTF-8 input, splits headers on the first equals, and emits bodyBase64', async () => {
  let received: MessageInput | undefined
  const protocol = fakeProtocol({
    enqueue: (_sessionId, input) => {
      received = input
      return sampleMessage(input.body)
    },
  })
  const result = await invoke([
    'enqueue', '--session-id', 'target', '--kind', 'example.v1', '--body', '你好',
    '--sender-session-id', 'sender', '--idempotency-key', 'key', '--header', 'trace=a=b',
  ], { protocol })
  assert.equal(result.exitCode, 0)
  assert.equal(result.stderr, '')
  assert.deepEqual(received, {
    kind: 'example.v1',
    body: Buffer.from('你好', 'utf8'),
    senderSessionId: 'sender',
    idempotencyKey: 'key',
    headers: { trace: 'a=b' },
  })
  const output = JSON.parse(result.stdout)
  assert.equal(output.body, undefined)
  assert.equal(output.bodyBase64, Buffer.from('你好').toString('base64'))
})

test('pending renders every opaque body as base64 without text decoding', async () => {
  const result = await invoke(['pending', '--session-id', 'target'], {
    protocol: fakeProtocol({ listPending: () => [sampleMessage(Buffer.from([0, 255, 65]))] }),
  })
  assert.equal(result.exitCode, 0)
  assert.equal(JSON.parse(result.stdout)[0].bodyBase64, 'AP9B')
})

test('an empty dequeue prints null and exits 0', async () => {
  const result = await invoke(['dequeue', '--session-id', 'target'])
  assert.deepEqual(result, { exitCode: 0, stdout: 'null\n', stderr: '' })
})

test('every opened protocol handle closes after success and operation failure', async () => {
  let closes = 0
  assert.equal((await invoke(['initialize', '--session-id', 'target'], {
    protocol: fakeProtocol({ close: () => { closes += 1 } }),
  })).exitCode, 0)
  assert.equal((await invoke(['dequeue', '--session-id', 'target'], {
    protocol: fakeProtocol({
      dequeue: () => { throw new ProtocolError('PROTOCOL_SESSION_UNKNOWN', 'unknown target') },
      close: () => { closes += 1 },
    }),
  })).exitCode, 1)
  assert.equal(closes, 2)
})

test('protocol errors exit 1 with exact protocol codes', async () => {
  const result = await invoke(['initialize', '--session-id', 'target'], {
    open: () => { throw new ProtocolError('PROTOCOL_DATABASE_UNAVAILABLE', 'cannot open') },
  })
  assert.deepEqual(result, {
    exitCode: 1,
    stdout: '',
    stderr: 'spex-session: PROTOCOL_DATABASE_UNAVAILABLE: cannot open\n',
  })
})

test('a missing parent keeps the protocol code and adds an actionable repair hint', async () => {
  const result = await invoke(['initialize', '--session-id', 'target'], {
    open: () => { throw new ProtocolError('PROTOCOL_PATH_PARENT_MISSING', 'parent does not exist') },
  })
  assert.equal(result.exitCode, 1)
  assert.equal(
    result.stderr,
    'spex-session: PROTOCOL_PATH_PARENT_MISSING: parent does not exist; create the parent directory or choose --database-path with an existing parent\n',
  )
})

test('environment and config fields cannot enable the locality override', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-selflaunch-cli-'))
  try {
    const configPath = join(root, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      databasePath: join(root, 'sessions.sqlite'),
      assumeLocalStorage: true,
    }))
    for (const env of [
      { SPEX_SESSION_DATABASE_PATH: join(root, 'sessions.sqlite'), SPEX_SESSION_ASSUME_LOCAL_STORAGE: '1' },
      { SPEX_SESSION_CONFIG: configPath },
    ]) {
      const result = await invoke(['initialize', '--session-id', 'target'], {
        env,
        requireLocal: (_path, options) => {
          assert.equal(options.assumeLocal, false)
          throw new LocalityError('LOCALITY_DETECTOR_UNAVAILABLE', 'no detector')
        },
        open: () => assert.fail('locality refusal must happen before protocol open'),
      })
      assert.equal(result.exitCode, 1)
      assert.equal(result.stderr, 'spex-session: LOCALITY_DETECTOR_UNAVAILABLE: no detector\n')
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('--assume-local-storage is the only argv path to the locality override', async () => {
  let assumption: boolean | undefined
  const result = await invoke([
    'initialize', '--session-id', 'target', '--assume-local-storage',
  ], {
    requireLocal: (path, options) => {
      assumption = options.assumeLocal
      return path
    },
  })
  assert.equal(result.exitCode, 0)
  assert.equal(assumption, true)
})
