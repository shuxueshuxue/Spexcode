import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
    assert.deepEqual(result, { ok: true, error: undefined, id: 'session-1', session: { id: 'session-1' } })
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

// THE LAUNCH COMPOSER'S SUBMIT. [[new-session-tab]]: a launch prompt is long-form, so Enter stays native
// editing and an explicit control is the only submit. The product had it exactly backwards — plain Enter
// fired the launch and no launch control was rendered at all, so the contract's stated submit path did not
// exist in the shipped UI. A blind spot found it: the scenario could not be measured for want of the button.
test('the New tab submits from its own control, never from a bare Enter', () => {
  const source = readFileSync(new URL('./SessionInterface.jsx', import.meta.url), 'utf8')
  assert.match(source, /className="si-launch" label=\{t\('session\.launchSend'\)\}/)
  assert.match(source, /disabled=\{!prompt\.trim\(\)\} onMouseDown=\{inertChromePress\} onClick=\{submit\}/)
  assert.doesNotMatch(source, /e\.key === 'Enter'[^\n]*active === 'new'[^\n]*submit\(\)/)
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
  assert.match(css, /\.si-launch\s*\{[^}]*background:\s*var\(--blue\)/s)
})
