import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProseTokens, renderProseTokens } from './proseTokens.js'

test('prose token adapter keeps source maps and promotes SpexCode marks', () => {
  const source = [
    '▶1:02 · inspect',
    '',
    '## Heading [[node-graph]]',
    '',
    'Read [the guide](https://example.test) and ![frame](/api/evidence/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa).',
  ].join('\n')
  const tokens = parseProseTokens(source)
  const anchor = tokens.find((token) => token.type === 'prose_time_anchor')
  assert.deepEqual(anchor?.map, [0, 1])
  assert.deepEqual(anchor?.meta, { tMs: 62_000, step: 'inspect', label: '▶1:02 · inspect' })

  const heading = tokens.find((token) => token.type === 'heading_open')
  assert.deepEqual(heading?.map, [2, 3])
  const inline = tokens.find((token) => token.type === 'inline' && token.map?.[0] === 2)
  assert.ok(inline)
  const ref = inline.children.find((token) => token.type === 'prose_spec_ref')
  assert.equal(ref?.meta.id, 'node-graph')
  assert.deepEqual(ref?.map, [2, 3])

  const evidence = tokens.flatMap((token) => token.children || []).find((token) => token.type === 'prose_evidence')
  assert.equal(evidence?.meta.hash, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  assert.deepEqual(evidence?.map, [4, 5])
})

test('the mapper renders semantic marks in place through caller handlers', () => {
  const source = '▶0:07 · inspect\n\nReply [[node-a]] ![frame](/api/evidence/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa).'
  const seen = []
  const h = (type, props, ...children) => ({ type, props: props || {}, children })
  const output = renderProseTokens(parseProseTokens(source), {
    h,
    renderTimeAnchor: (meta) => { seen.push(['time', meta.tMs]); return h('button', {}, meta.label) },
    renderSpecRef: (id) => { seen.push(['ref', id]); return h('a', {}, id) },
    renderEvidence: (meta) => { seen.push(['evidence', meta.hash]); return h('span', {}, meta.alt) },
  })
  assert.deepEqual(seen, [
    ['time', 7_000],
    ['ref', 'node-a'],
    ['evidence', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  ])
  assert.equal(output[0].type, 'button')
  assert.equal(output[1].type, 'p')
})

// A soft break is where the author's line ended; a hard break is content the author asked for. Only the
// first is a surface decision, so the same tokens must reflow for a document and break for a message.
test('a soft break follows the surface while a hard break always breaks', () => {
  const h = (type, props, ...children) => ({ type, props: props || {}, children })
  const text = (node) => {
    if (typeof node === 'string') return node
    if (Array.isArray(node)) return node.map(text).join('')
    if (node?.type === 'br') return '<br>'
    return text(node?.children || [])
  }
  const render = (source, softBreak) => text(renderProseTokens(parseProseTokens(source), { h, softBreak }))

  assert.equal(render('first line\nsecond line'), 'first line second line')
  assert.equal(render('first line\nsecond line', 'break'), 'first line<br>second line')
  assert.equal(render('first line  \nsecond line'), 'first line<br>second line')
  assert.equal(render('first line\\\nsecond line'), 'first line<br>second line')
  assert.equal(render('> quoted line\n> second line'), 'quoted line second line')
})

test('math typesetting survives the cache and degrades a rejected source to its text', () => {
  const h = (type, props, ...children) => ({ type, props: props || {}, children })
  const math = (source) => {
    const found = []
    const walk = (node) => {
      if (!node || typeof node === 'string') return
      if (Array.isArray(node)) return node.forEach(walk)
      if (node.props?.['data-math-source'] !== undefined) found.push(node)
      walk(node.children)
    }
    walk(renderProseTokens(parseProseTokens(source), { h }))
    return found
  }
  const [first] = math('Energy is $E = mc^2$ today.')
  const [second] = math('Energy is $E = mc^2$ again.')
  assert.match(first.props.dangerouslySetInnerHTML.__html, /class="katex"/)
  assert.equal(first.props.dangerouslySetInnerHTML.__html, second.props.dangerouslySetInnerHTML.__html)
  assert.equal(first.props['data-math-source'], 'E = mc^2')
  assert.equal(math('Inline $x^2$ and display below.\n\n$$\\int_0^1 x^2 dx$$').length, 2)
})
