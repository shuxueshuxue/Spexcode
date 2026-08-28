import test from 'node:test'
import assert from 'node:assert/strict'
import { conversationItems, splitEnvelope } from './conversationItems.js'
import { SCENARIOS, at, sent, status } from '../test/fixtures/conversation-tail.scenarios.mjs'
import en from './i18n/en.js'

const NOW = Date.parse('2026-08-27T16:00:00.000Z')
const shape = (item) => item.kind === 'seam' ? { kind: 'seam', open: item.open }
  : item.kind === 'quote' ? { kind: 'quote' }
    : { kind: item.kind, status: item.status }

// The shapes the status machine really writes, each with the row list the reader is owed. The same table
// drives the browser run; here it is read straight off the derivation.
for (const scenario of SCENARIOS) {
  test(`${scenario.name}: ${scenario.expect.map((row) => row.kind + (row.open ? '·open' : '')).join(' → ')}`, () => {
    assert.deepEqual(conversationItems(scenario.events, NOW).map(shape), scenario.expect)
  })
}

test('a seam owns exactly the interval between its neighbours; the open tail ends at the mount-time now', () => {
  const items = conversationItems(SCENARIOS.find((s) => s.name === 'second-message-while-working').events, NOW)
  const seams = items.filter((item) => item.kind === 'seam')
  assert.deepEqual(seams.map((seam) => [seam.from, seam.to]), [
    [Date.parse(at(0)), Date.parse(at(60))],
    [Date.parse(at(120.2)), Date.parse(at(200))],  // the first message landed on a close-pending agent: its `active` re-entry opens the seam
    [Date.parse(at(200)), NOW],                    // the second message: no status event follows, the seam is still owed
  ])
})

test('the envelope is stripped from a peer quote and its sender kept', () => {
  const [, , quote] = conversationItems(SCENARIOS.find((s) => s.name === 'peer-message-into-asking-session').events, NOW)
  assert.equal(quote.text, 'peer reply')
  assert.deepEqual(quote.envelope, { label: null, id: 'peer-1' })
  assert.deepEqual(splitEnvelope('plain'), { text: 'plain', envelope: null })
})

// THE THEOREM, over every event order: the record's last word `working` ⟹ the last item is an open seam, and
// otherwise no item is open; every event that is not a bare `working` is exactly one item, in order; seams
// never touch. A seeded generator walks the machine's vocabulary so the run is reproducible.
// the machine's vocabulary is the dashboard's one status dictionary, not a second list minted here
const VOCABULARY = [
  (s) => status(s, 'working'),
  ...Object.keys(en.status).map((word) => (s) => status(s, word, `a note on ${word}`)),
  (s) => sent(s, 'a human message'),
  (s) => sent(s, 'a peer message', 'peer-1'),
]
const mulberry32 = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

test('the theorem holds over 2000 generated timelines', () => {
  const random = mulberry32(4529)
  for (let run = 0; run < 2000; run++) {
    const events = []
    let seconds = 0
    for (let n = Math.floor(random() * 12); n > 0; n--) {
      seconds += 1 + Math.floor(random() * 100)
      events.push(VOCABULARY[Math.floor(random() * VOCABULARY.length)](seconds))
    }
    const items = conversationItems(events, NOW)
    const lastWord = [...events].reverse().find((event) => event.kind === 'status')
    const working = lastWord?.display === 'working'
    const label = `run ${run}: ${events.map((e) => e.kind === 'sent' ? (e.from ? 'peer' : 'human') : e.display + (e.note ? '!' : '')).join(' ')}`

    const tail = items.at(-1)
    if (working) assert.ok(tail?.kind === 'seam' && tail.open, `${label} — working record must end with an open seam`)
    assert.equal(items.filter((item) => item.kind === 'seam' && item.open).length, working ? 1 : 0, `${label} — open seams`)

    const said = events.filter((event) => !(event.kind === 'status' && event.display === 'working' && !event.note))
    assert.deepEqual(items.filter((item) => item.kind !== 'seam').map((item) => item.ts), said.map((event) => event.ts), `${label} — every message and event once, in order`)

    for (let i = 1; i < items.length; i++) {
      assert.ok(!(items[i].kind === 'seam' && items[i - 1].kind === 'seam'), `${label} — seams never touch`)
    }
    for (const seam of items.filter((item) => item.kind === 'seam')) assert.ok(seam.to > seam.from, `${label} — a seam lasts`)
  }
})
