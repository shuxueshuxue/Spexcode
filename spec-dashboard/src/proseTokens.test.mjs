import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProseTokens } from './proseTokens.js'

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
