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

// THE LAUNCH COMPOSER'S SUBMIT. [[new-session-tab]]: plain Enter launches, Shift+Enter inserts a line,
// and the explicit control remains the pointer twin. Completion menus consume Enter before this textarea
// handler, so choosing a dropdown item cannot launch accidentally.
test('the New tab launches on plain Enter and keeps Shift+Enter for multiline drafts', () => {
  const source = readFileSync(new URL('./SessionInterface.jsx', import.meta.url), 'utf8')
  assert.match(source, /className="si-launch" label=\{t\('session\.launchSend'\)\}/)
  assert.match(source, /disabled=\{!prompt\.trim\(\)\} onMouseDown=\{inertChromePress\} onClick=\{submit\}/)
  assert.match(source, /className="si-input"[\s\S]*?onKeyDown=\{\(event\) => \{[\s\S]*?event\.key !== 'Enter' \|\| event\.shiftKey \|\| composingKey\(event\)[\s\S]*?submit\(\)/)
  assert.match(source, /if \(menu\) \{[\s\S]*?accept\(menu\.items\[menu\.index\]\)/)
  assert.match(source, /markTabHold\('sessions', result\.id, null\)[\s\S]*?scope\.open\(\{ page: 'sessions', param: result\.id, query: null \}\)/)
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
  assert.match(css, /\.si-launch\s*\{[^}]*background:\s*var\(--blue\)/s)
  assert.match(css, /\.sess-ops\s*\{[^}]*order:\s*1;/s)
  assert.match(css, /\.sess-glyph\s*\{[^}]*order:\s*2;/s)
})
