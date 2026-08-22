import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { openProjectSessionApplication } from '@spexcode/session-application'

import { readTimeline } from './session-timeline.js'
import { resetConfiguredSessionApplicationForTest } from './session-application.js'

test('cutover timeline projection reads conversation events from the application database', () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-cutover-timeline-'))
  const previousHome = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  const databasePath = join(home, 'sessions.sqlite')
  mkdirSync(home, { recursive: true })
  writeFileSync(`${databasePath}.json-migration.json`, '{"version":1}\n')
  const app = openProjectSessionApplication({ databasePath, locality: () => {} })
  app.createSession({ sessionId: 'conversation' })
  app.enqueueConversationMessage('conversation', {
    kind: 'session.prompt.v1',
    body: Buffer.from('transport bytes'),
    senderSessionId: null,
  }, { text: 'visible prompt', from: null, replyVia: 'note' })

  try {
    const timeline = readTimeline('conversation')
    assert.ok(timeline)
    assert.deepEqual(timeline.events.map(event => event.kind), ['status', 'sent'])
    assert.deepEqual(timeline.events[1], {
      ts: timeline.events[1]?.ts,
      kind: 'sent',
      mid: timeline.events[1]?.kind === 'sent' ? timeline.events[1].mid : '',
      text: 'visible prompt',
      from: null,
      replyVia: 'note',
    })
    assert.equal(existsSync(join(home, 'sessions', 'conversation', 'timeline.ndjson')), false)
  } finally {
    app.close()
    resetConfiguredSessionApplicationForTest()
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
  }
})
