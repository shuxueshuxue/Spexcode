import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSession, isDashboardVisibleHarness } from './launch.js'

test('dashboard hides external adapter harnesses from launch and target choices', () => {
  assert.equal(isDashboardVisibleHarness('zcode'), false)
  assert.equal(isDashboardVisibleHarness('codex'), true)
  const source = readFileSync(new URL('./launch.js', import.meta.url), 'utf8')
  assert.match(source, /dashboardLauncherListFrom[\s\S]*list\.filter\(\(entry\) => isDashboardVisibleHarness\(entry\?\.harness\)\)/)
  assert.match(source, /harnessTargets[\s\S]*isDashboardVisibleHarness\(id\)/)
})

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
  // The new-tab mark must be IMPORTED, not only spelled: the call alone once shipped as a ReferenceError
  // inside the create promise, so the composer created the session and then never left the launch page.
  assert.match(source, /import \{[^}]*\bmarkNewTab\b[^}]*\} from '\.\/tabs\.js'/)
  assert.match(source, /markNewTab\('sessions', result\.id, null\)[\s\S]*?scope\.open\(\{ page: 'sessions', param: result\.id, query: null \}\)/)
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
  assert.match(css, /\.si-launch\s*\{[^}]*background:\s*var\(--blue\)/s)
  assert.match(css, /\.sess-ops\s*\{[^}]*order:\s*1;/s)
  assert.match(css, /\.sess-glyph\s*\{[^}]*order:\s*2;/s)
})

test('the New tab sends harness configuration to Settings', () => {
  const source = readFileSync(new URL('./SessionInterface.jsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /add-harness-target|AddHarnessTargetModal|onAdd=/)
  assert.match(source, /onSettings=\{\(\) => scope\.open\(\{ page: 'settings'/)
  assert.doesNotMatch(css, /\.si-launcher-add\s*\{/)
  assert.match(css, /\.si-launcher-pop-head\s*\{/)
})

test('Settings owns launcher and built-in harness configuration', () => {
  const source = readFileSync(new URL('./Settings.jsx', import.meta.url), 'utf8')
  assert.match(source, /data-settings-launchers/)
  assert.match(source, /data-settings-harnesses/)
  assert.match(source, /addProjectHarnessTarget\(PROJECT_ID, selected, revision\)/)
  assert.match(source, /LAUNCHER_TYPES = \['claude', 'claude-headless'/)
  assert.match(source, /sessions: \{ \.\.\.sessions, launchers: profiles \}/)
  assert.match(source, /configOpen/)
  assert.doesNotMatch(source, /plugin host|adopter|\.plugins|zcode/)
})

test('project rows expose a one-step catalog-registration removal action', () => {
  const source = readFileSync(new URL('./ProjectsPage.jsx', import.meta.url), 'utf8')
  assert.match(source, /icon="trash"/)
  assert.match(source, /removeProject\(p\.id, confirmation\)/)
  const modal = source.slice(source.indexOf('function RemoveProjectModal'), source.indexOf('function ProjectRow'))
  assert.match(modal, /const phrase = `REMOVE \$\{project\.identity\.title\}`/)
  assert.match(modal, /t\('projects\.removeWarning', \{ name: project\.identity\.title \}\)/)
  assert.match(modal, /onClick=\{\(\) => onRemove\(phrase\)\}/)
  assert.doesNotMatch(modal, /type="checkbox"|<input|removeUnderstand|removeTypeLabel/)
})
