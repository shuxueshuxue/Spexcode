import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { sendSessionText } from './data.js'

const here = dirname(fileURLToPath(import.meta.url))
const mobileApp = readFileSync(join(here, 'MobileApp.jsx'), 'utf8')
const timelineChat = readFileSync(join(here, 'TimelineChat.jsx'), 'utf8')

test('mobile session detail retains the TimelineChat composer', () => {
  assert.match(mobileApp, /<TimelineChat s=\{s\} sessions=\{sessions\} \/>/)
  assert.match(timelineChat, /className="m-input"/)
  assert.match(timelineChat, /className="m-send"/)
  assert.match(timelineChat, /sendSessionText\(s\.id, text, \{ replyVia: 'note' \}\)/)
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
