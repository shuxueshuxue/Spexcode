import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { LiveTail, Quote, ToolLine, TranscriptUi, TranscriptView, alreadySaid, parseEnvelope, prettyInput, spexEnvelope, toolName, type EnvelopeParser, currentTurn, defaultLabels, defaultVocabulary, extendVocabulary, liveSlice, runKinds, segments, splitTarget, toolTarget, toolVerb, useTranscriptFrames, type AnyTurn } from './index.js'

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

test('codex exec/wait read as a sentence: a bare-string command shows its first line, exec/wait get verbs', () => {
  // codex code-mode `exec` input is a bare JS string, not JSON; before, a >80-char bare string yielded NO target,
  // so the row said only "exec 4 lines". Now its first line names it.
  assert.equal(toolVerb('exec'), 'Ran')
  assert.equal(toolVerb('wait'), 'Waited')
  const execInput = 'const r = await tools.exec_command({cmd:"spex session ask --note READY",workdir:"/tmp/proj"}); text(r.output);'
  assert.equal(toolTarget(execInput), execInput, 'a one-line command is its own target, not null')
  assert.equal(toolTarget('#!/usr/bin/env bash\nset -e\nnpm test'), '#!/usr/bin/env bash', 'a multi-line script shows its head')
  assert.equal(toolTarget(JSON.stringify({ cell_id: '1', yield_time_ms: 30000 })), '1', 'wait names its cell')
  const html = renderToStaticMarkup(createElement(TranscriptView, { data: { turns: [turn('a1', 'assistant', undefined, [tool('e1', 'exec', execInput, 'ok\nok\nok\nok', 4)])] } }))
  assert.match(html, /tx-tool-verb">Ran</)
  assert.match(html, /exec_command/, 'the command is on the row, not hidden behind the caret')
  assert.doesNotMatch(html, />exec</, 'the raw tool name no longer stands in for a verb')
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

test('an opened call says how much of its result the cap left out, and stays silent when nothing was cut', () => {
  const call = (id: string, output: string, outputBytes: number) =>
    ({ id, name: 'Bash', input: JSON.stringify({ command: 'make' }), output, outputLines: 1, outputBytes }) as Parameters<typeof ToolLine>[0]['tool']
  const open = (t: Parameters<typeof ToolLine>[0]['tool']) =>
    renderToStaticMarkup(createElement(ToolLine, { tool: t, open: true, onToggle: () => {} }))
  // the body stops at the per-tool cap while outputBytes keeps the result's true size: the gap is what is missing
  assert.match(open(call('b1', 'first 3', 70_000)), /tx-tool-cut">69,993 more bytes not shown</)
  assert.doesNotMatch(open(call('b2', 'two files', 9)), /tx-tool-cut/)
})

test('a result is drawn as text: the colour a program printed is dropped from the page, not from the record', () => {
  const painted = '\u001b[91m\u001b[1mError:\u001b[0m boom\u001b]0;title\u0007'
  const t = { id: 'b3', name: 'Bash', input: '\u001b[2mmake\u001b[0m', output: painted, outputLines: 1, outputBytes: Buffer.byteLength(painted) } as Parameters<typeof ToolLine>[0]['tool']
  const html = renderToStaticMarkup(createElement(ToolLine, { tool: t, open: true, onToggle: () => {} }))
  assert.match(html, />Error: boom</)
  assert.doesNotMatch(html, /\[91m|\[0m|\[1m|\[2m/)
  assert.doesNotMatch(html, /\u001b/)
  // the escapes counted toward the record's size, so dropping them from the page must not invent a cut
  assert.doesNotMatch(html, /tx-tool-cut/)
})

test('a quoted turn is read through the envelope rows: the SpexCode footer by default, a host row beside it', () => {
  const footer = 'peer reply\n\n— from session "gugu-leader" (a789e37c) on machine m1. To reply: spex session send --ssh x a789e37c "<your reply>"'
  assert.deepEqual(spexEnvelope(footer), { who: 'gugu-leader', id: 'a789e37c', body: 'peer reply' })
  assert.deepEqual(spexEnvelope('plain'), null)
  assert.deepEqual(parseEnvelope('plain'), { who: null, body: 'plain' })
  const xml: EnvelopeParser = (text) => {
    const m = /^<gugu_delivery\b([^>]*)>([\s\S]*?)<\/gugu_delivery>\s*$/.exec(text.trim())
    if (!m) return null
    const from = /\bfrom="([^"]*)"/.exec(m[1])
    return { who: from?.[1] ?? null, body: m[2].replace(/<reply_to\b[^>]*>[\s\S]*?<\/reply_to>/g, '').trim() }
  }
  const turns: AnyTurn[] = [turn('u1', 'user', '<gugu_delivery route="chat" from="Codex 9 (user:66f5)">\n<reply_to msg="m1"></reply_to>\n赞同。再补一个验证点。\n</gugu_delivery>'), turn('u2', 'user', footer)]
  const html = renderToStaticMarkup(createElement(TranscriptUi, { userTurns: 'quote', envelopes: [spexEnvelope, xml] }, createElement(TranscriptView, { data: { turns } })))
  assert.match(html, /tx-quote-who">Codex 9 \(user:66f5\)</)
  assert.match(html, /赞同。再补一个验证点。/)
  assert.doesNotMatch(html, /gugu_delivery|reply_to|route=/, 'the envelope is addressing, not what was said')
  assert.match(html, /tx-quote-who">gugu-leader</)
  assert.doesNotMatch(html, /To reply: spex session send/)
})

test("fold: 'runs' keeps every working message on the page and folds only the tool runs inside a turn", () => {
  const turns: AnyTurn[] = [
    turn('u1', 'user', 'do it'),
    turn('a2', 'assistant', 'Looking at the layout first', [tool('t1', 'Read', { file_path: 'a' }, 'x', 1), tool('t2', 'Read', { file_path: 'b' }, 'y', 1), tool('t3', 'Grep', { pattern: 'z' }, '', 0)]),
    turn('a3', 'assistant', 'Now the styles', [tool('t4', 'Read', { file_path: 'c' }, 'w', 1)]),
    turn('a4', 'assistant', 'All done'),
  ]
  const folded = renderToStaticMarkup(createElement(TranscriptView, { data: { turns } }))
  assert.match(folded, /tx-work-row/, 'the default folds the whole process behind its answer')
  assert.doesNotMatch(folded, /Looking at the layout first/)
  const runs = renderToStaticMarkup(createElement(TranscriptUi, { fold: 'runs' }, createElement(TranscriptView, { data: { turns } })))
  assert.doesNotMatch(runs, /tx-work-row/)
  assert.match(runs, /Looking at the layout first/)
  assert.match(runs, /Now the styles/)
  assert.match(runs, /3 tool uses/, 'a run of three inside one turn still folds to a row')
  assert.match(runs, /tx-tool-verb">Read</, 'a lone call stays a sentence')
})

test('an MCP call names its server apart from its tool, and opened arguments read one field per line', () => {
  assert.deepEqual(toolName('mcp__gugu-im__message_reply'), { tool: 'message_reply', server: 'gugu-im' })
  assert.deepEqual(toolName('Bash'), { tool: 'Bash', server: null })
  assert.equal(toolVerb('mcp__gugu-im__message_reply'), 'message_reply', 'unnamed: the tool half, never the mangled id')
  assert.equal(toolVerb('mcp__gugu-im__message_reply', extendVocabulary(defaultVocabulary, { verbs: { message_reply: 'Replied' } })), 'Replied', 'the bare tool name is a vocabulary key')
  assert.equal(prettyInput(JSON.stringify({ chat: '202016', text: 'hi' })), '{\n  "chat": "202016",\n  "text": "hi"\n}')
  assert.equal(prettyInput('print(1)\nprint(2)'), 'print(1)\nprint(2)')
  const html = renderToStaticMarkup(createElement(TranscriptView, { data: { turns: [turn('a1', 'assistant', undefined, [tool('m1', 'mcp__gugu-im__message_reply', { chat: '202016' }, 'ok', 1)])] } }))
  assert.match(html, /tx-tool-server">gugu-im</)
  assert.match(html, /tx-tool-verb">message_reply</)
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
