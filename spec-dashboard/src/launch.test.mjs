import test from 'node:test'
import assert from 'node:assert/strict'
import { createSession } from './launch.js'

test('ordinary interactive launch posts only the prompt and named launcher', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, init) => {
    request = { url, init }
    return { ok: true, json: async () => ({ id: 'session-1' }) }
  }

  try {
    const result = await createSession('/tidy [[mobile-ui]] keep the composer', 'codex-local', 'must not cross the Dashboard boundary')
    assert.deepEqual(result, { ok: true, error: undefined })
    assert.equal(request.url, '/api/sessions')
    assert.equal(request.init.method, 'POST')
    assert.ok(request.init.headers['Idempotency-Key'], 'one create attempt carries a recoverable identity')
    assert.deepEqual(JSON.parse(request.init.body), {
      prompt: '/tidy [[mobile-ui]] keep the composer',
      launcher: 'codex-local',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('failed launch preserves the backend error code and phase', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      error: 'project main branch does not name a commit: master; create an initial Git commit before starting a session',
      code: 'session_create_failed',
      phase: 'target-resolution',
    }),
  })

  try {
    const result = await createSession('start the game', 'codex-local')
    assert.deepEqual(result, {
      ok: false,
      error: 'project main branch does not name a commit: master; create an initial Git commit before starting a session',
      code: 'session_create_failed',
      phase: 'target-resolution',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('unreachable launch reports a request failure instead of dropping the reason', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('connection refused') }

  try {
    const result = await createSession('start the game', 'codex-local')
    assert.deepEqual(result, {
      ok: false,
      error: 'connection refused',
      code: 'session_create_failed',
      phase: 'request',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
