import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { sendSessionText } from './data.js'

const here = dirname(fileURLToPath(import.meta.url))
const mobileApp = readFileSync(join(here, 'MobileApp.jsx'), 'utf8')
const timelineChat = readFileSync(join(here, 'TimelineChat.jsx'), 'utf8')
const styles = readFileSync(join(here, 'styles.css'), 'utf8')

test('mobile session detail retains the aligned TimelineChat composer', () => {
  assert.match(mobileApp, /<TimelineChat s=\{s\} sessions=\{sessions\} \/>/)
  assert.match(timelineChat, /<ComposerTextarea[\s\S]*className="m-input"/)
  assert.match(timelineChat, /!e\.shiftKey && !composingKey\(e\)/)
  assert.match(timelineChat, /className="m-send"/)
  assert.match(timelineChat, /sendSessionText\(s\.id, text, \{ replyVia: 'note' \}\)/)
  // the input and its send button are ONE row; the button rides the bottom edge so a grown textarea pushes
  // upward past it instead of stretching it ([[typography]]'s composer surface owns the frame, not the field)
  assert.match(styles, /\.m-composer-line\s*\{[^}]*align-items:\s*flex-end;/s)
  assert.match(styles, /\.m-send\s*\{[^}]*align-self:\s*flex-end;[^}]*height:\s*26px;/s)
  assert.match(styles, /\.m-tabbar\s*\{[^}]*padding-bottom:\s*env\(safe-area-inset-bottom, 0\);/s)
  assert.doesNotMatch(styles, /\.m-composer\s*\{[^}]*safe-area-inset-bottom/s)
})

test('both mobile-authored composers use the shared auto-growing textarea', () => {
  assert.match(mobileApp, /<ComposerTextarea[\s\S]*className="m-input m-new-input"/)
  // the field is borderless inside the composer card — one frame, not a bordered input in a bordered bar —
  // so its resting height is the line box, and the declared growth cap is unchanged.
  assert.match(styles, /\.m-input\s*\{[^}]*min-height:\s*26px;[^}]*max-height:\s*min\(28cqh, 240px\);/s)
  assert.match(styles, /\.m-new-input\s*\{[^}]*flex:\s*none;[^}]*min-height:\s*120px;/s)
})

test('mobile new-session action uses the shared plus icon, not a Unicode glyph', () => {
  assert.match(mobileApp, /import \{ Icon \} from '\.\/icons\.jsx'/)
  assert.match(mobileApp, /<button className="m-new-btn"[\s\S]*<Icon name="plus" size=\{16\}/)
  assert.doesNotMatch(mobileApp, /m-new-btn-plus|＞|＋/)
  // its keyboard focus is the one shared ring ([[typography]]), not an outline of its own
  assert.match(styles, /:focus-visible\s*\{[^}]*box-shadow:\s*var\(--focus-ring\);/)
  assert.doesNotMatch(styles, /\.m-new-btn:focus-visible\s*\{[^}]*outline:/)
})

test('mobile composer transport requests a declaration-note reply', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, init) => {
    request = { url, init }
    return { ok: true, json: async () => ({ ok: true }) }
  }

  try {
    const result = await sendSessionText('session-7', 'retained mobile reply', { replyVia: 'note' })
    assert.equal(result.ok, true)
    assert.equal(request.url, '/api/sessions/session-7/input')
    assert.deepEqual(JSON.parse(request.init.body), {
      kind: 'text',
      text: 'retained mobile reply',
      replyVia: 'note',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
