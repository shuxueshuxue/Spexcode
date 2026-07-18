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
    const result = await createSession('/tidy [[mobile-ui]] keep the composer', 'codex-local')
    assert.deepEqual(result, { ok: true, error: undefined })
    assert.equal(request.url, '/api/sessions')
    assert.equal(request.init.method, 'POST')
    assert.deepEqual(JSON.parse(request.init.body), {
      prompt: '/tidy [[mobile-ui]] keep the composer',
      launcher: 'codex-local',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
