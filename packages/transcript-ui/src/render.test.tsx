import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { LiveTail, Quote, TranscriptUi, TranscriptView, alreadySaid, currentTurn, defaultLabels, defaultVocabulary, extendVocabulary, liveSlice, runKinds, segments, splitTarget, toolTarget, toolVerb, useTranscriptFrames, type AnyTurn } from './index.js'

const tool = (id: string, name: string, input: unknown, output?: string | null, outputLines = 0) =>
  ({ id, name, input: JSON.stringify(input), ...(output === undefined ? {} : { output }), outputLines, outputBytes: output ? output.length : 0 }) as AnyTurn extends { tools?: readonly (infer T)[] } ? T : never
const turn = (id: string, role: 'user' | 'assistant', text?: string, tools?: readonly ReturnType<typeof tool>[]): AnyTurn => ({ id, at: Number(id.replace(/\D/g, '')) || 1, role, text, tools })

test('vocabulary: verb, target, split, kinds — and an adopter extends it as data', () => {
  assert.equal(toolVerb('Bash'), 'Ran')
  assert.equal(toolVerb('mystery'), 'mystery')
  assert.equal(toolTarget(JSON.stringify({ file_path: '/a/b/c.ts' })), '/a/b/c.ts')
  assert.equal(toolTarget('not json but short'), 'not json but short')
  assert.equal(toolTarget(JSON.stringify({ nothing: 1 })), null)
  assert.deepEqual(splitTarget('/a/b/c.ts'), { lead: 'c.ts', trail: '/a/b' })
  assert.equal(runKinds([tool('1', 'Bash', {}), tool('2', 'Bash', {})]), 'ran')
  assert.equal(runKinds([tool('1', 'Bash', {}), tool('2', 'Read', {})]), '1 ran, 1 read')
  const gemini = extendVocabulary(defaultVocabulary, { verbs: { run_shell_command: 'Ran' }, targetKeys: ['absolute_path'] })
  assert.equal(toolVerb('run_shell_command', gemini), 'Ran')
  assert.equal(toolTarget(JSON.stringify({ absolute_path: '/x/y.md' }), gemini), '/x/y.md')
})

test('segments: the process folds behind its answer, the work in progress never folds, user turns are boundaries or quotes', () => {
  const turns: AnyTurn[] = [
    turn('u1', 'user', 'do it'),
    turn('a2', 'assistant', undefined, [tool('t1', 'Read', { path: 'a' }, 'x'), tool('t2', 'Read', { path: 'b' }, 'y'), tool('t3', 'Grep', { pattern: 'z' }, '')]),
    turn('a3', 'assistant', 'done'),
    turn('u4', 'user', 'more'),
    turn('a5', 'assistant', undefined, [tool('t4', 'Bash', { command: 'ls' })]),
  ]
  const closed = segments(turns)
  assert.deepEqual(closed.map((s) => s.kind), ['work', 'work'])
  assert.equal((closed[0] as { folded: boolean }).folded, true, 'three calls before an answer fold')
  assert.equal((closed[1] as { folded: boolean }).folded, false)
  const live = segments(turns, { live: true })
  assert.equal((live[1] as { now: boolean }).now, true)
  const quoted = segments(turns, { userTurns: 'quote' })
  assert.deepEqual(quoted.map((s) => s.kind), ['quote', 'work', 'quote', 'work'])
  assert.equal((segments(turns, { fold: 'none' })[0] as { folded: boolean }).folded, false)
  assert.deepEqual(currentTurn(turns).map((t) => t.id), ['a5'])
  assert.deepEqual(liveSlice(turns).map((t) => t.id), ['a5'])
  assert.equal(alreadySaid('done ...', 'done'), true)
  assert.equal(alreadySaid('done', 'other'), false)
})

test('TranscriptView draws the grammar: quote, prose as the page, a call as a sentence, a running call marked, the fold row', () => {
  const data = { turns: [
    turn('u1', 'user', 'please run the tests'),
    turn('a2', 'assistant', undefined, [tool('t1', 'Read', { file_path: '/repo/src/a.ts' }, 'aaa', 1), tool('t2', 'Read', { file_path: '/repo/src/b.ts' }, 'bbb', 1), tool('t3', 'Grep', { pattern: 'x' }, '', 0)]),
    turn('a3', 'assistant', 'All green.\n\nSecond paragraph'),
    turn('a4', 'assistant', undefined, [tool('t4', 'Bash', { command: 'npm test' })]),
  ], truncated: true, omittedTurns: 2, omittedBytes: 10, outOfOrderEvents: 0 }
  const closedHtml = renderToStaticMarkup(createElement(TranscriptView, { data }))
  assert.match(closedHtml, /class="tx tx-flow"/)
  assert.match(closedHtml, /tx-work-row[^>]*>.*3 tool uses.*read/, 'history folds three reads behind the answer')
  assert.match(closedHtml, /<p>All green\.<\/p><p>Second paragraph<\/p>/, 'the default prose keeps paragraphs')
  assert.doesNotMatch(closedHtml, /tx-quote/, 'user turns are boundaries by default')
  assert.doesNotMatch(closedHtml, /tx-tool-running/, 'a closed interval never says running')
  assert.match(closedHtml, /truncated: 2 turns and 10 bytes omitted/)
  const liveHtml = renderToStaticMarkup(createElement(TranscriptUi, { userTurns: 'quote', children: createElement(TranscriptView, { data, live: true }) }))
  assert.match(liveHtml, /tx-quote/, 'the host may quote user turns')
  assert.match(liveHtml, /please run the tests/)
  assert.match(liveHtml, /tx-tool-running/, 'the call after the answer has no result and is running')
  assert.match(liveHtml, /tx-tool-verb">Ran<\/span><span class="tx-tool-target">npm test/, 'verb + target sentence')
  assert.doesNotMatch(liveHtml, /[\u{1F300}-\u{1FAFF}]/u, 'no emoji')
  const labelled = renderToStaticMarkup(createElement(TranscriptUi, { labels: { ...defaultLabels, toolUses: (n) => `${n} 次工具调用` }, children: createElement(TranscriptView, { data }) }))
  assert.match(labelled, /3 次工具调用/)
})

test('LiveTail shows the current turn, elides prose the record already said, marks speaking', () => {
  const turns: AnyTurn[] = [turn('u1', 'user', 'go'), turn('a2', 'assistant', 'I will look'), turn('a3', 'assistant', 'Here is the answer')]
  const speaking = renderToStaticMarkup(createElement(LiveTail, { turns }))
  assert.match(speaking, /tx-live is-speaking/)
  assert.match(speaking, /Here is the answer/)
  assert.doesNotMatch(speaking, /I will look/, 'only the newest prose is the tail')
  assert.equal(renderToStaticMarkup(createElement(LiveTail, { turns, lastSaid: 'Here is the answer' })), '', 'said on the record and nothing running → nothing')
  const working: AnyTurn[] = [...turns, turn('a4', 'assistant', undefined, [tool('t', 'Bash', { command: 'sleep' })])]
  const html = renderToStaticMarkup(createElement(LiveTail, { turns: working, lastSaid: 'Here is the answer' }))
  assert.doesNotMatch(html, /Here is the answer/)
  assert.match(html, /tx-tool-running/)
  assert.doesNotMatch(html, /is-speaking/, 'a call after the prose ends the caret')
})

test('a failed or rejected call wears the word, a fold counts its failures, success stays silent', () => {
  const failed = { ...tool('f1', 'Bash', { command: 'x' }, 'boom', 1), outcome: 'failed' as const }
  const rejected = { ...tool('f2', 'Bash', { command: 'rm' }, ''), outcome: 'rejected' as const }
  const fine = tool('f3', 'Read', { file_path: '/a.ts' }, 'ok', 1)
  const html = renderToStaticMarkup(createElement(TranscriptView, { data: { turns: [turn('a1', 'assistant', undefined, [failed, rejected])] } }))
  assert.match(html, /tx-tool is-failed/)
  assert.match(html, /tx-tool-outcome is-failed">failed</)
  assert.match(html, /tx-tool-outcome is-rejected">rejected</)
  const clean = renderToStaticMarkup(createElement(TranscriptView, { data: { turns: [turn('a1', 'assistant', undefined, [fine])] } }))
  assert.doesNotMatch(clean, /tx-tool-outcome/)
  const folded = renderToStaticMarkup(createElement(TranscriptView, { data: { turns: [turn('a1', 'assistant', undefined, [failed, fine, fine, fine]), turn('a2', 'assistant', 'done')] } }))
  assert.match(folded, /4 tool uses/)
  assert.match(folded, /tx-tool-outcome is-failed">1 failed</)
})

test('Quote clamps a long text and names the peer', () => {
  const html = renderToStaticMarkup(createElement(Quote, { who: 'peer', ts: 0, text: 'x'.repeat(800) }))
  assert.match(html, /tx-quote is-clamped/)
  assert.match(html, /tx-quote-who">peer/)
  assert.match(html, /tx-quote-more/)
})

test('useTranscriptFrames merges frames through the protocol', () => {
  let api: ReturnType<typeof useTranscriptFrames> | null = null
  function Probe() { api = useTranscriptFrames(); return null }
  renderToString(createElement(Probe))
  assert.ok(api)
})
