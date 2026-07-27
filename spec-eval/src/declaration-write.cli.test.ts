import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeScenarioMeasurementMetadata } from './scenarios.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const cli = join(root, 'spec-cli', 'src', 'cli.ts')

const source = [
  '---',
  'scenarios:',
  '    - name: exact-case',
  '      tags: [cli]',
  '      description: >-',
  '        measure one concrete case',
  '      expected: >-',
  '        the case passes',
  '---',
  '# body remains byte-identical',
  '',
].join('\r\n')

function run(input: string, mutation: unknown) {
  return spawnSync('tsx', [cli, 'eval', 'scenario', 'write', '--mutation', JSON.stringify(mutation)], {
    cwd: root,
    input,
    encoding: 'utf8',
  })
}

test('real spex eval scenario write matches the library and round-trips authoritative bytes', () => {
  const insert = {
    scenario: 'exact-case',
    insert: { test: { path: 'spec-eval/src/scenarios.test.ts', name: 'one exact case' } },
  }
  const expected = writeScenarioMeasurementMetadata(source, insert)
  const written = run(source, insert)
  assert.equal(written.status, 0, written.stderr)
  assert.equal(written.stderr, '')
  assert.equal(written.stdout, expected)

  const removed = run(written.stdout, { scenario: 'exact-case', delete: 'test' })
  assert.equal(removed.status, 0, removed.stderr)
  assert.equal(removed.stderr, '')
  assert.equal(removed.stdout, source)
})

test('real spex eval scenario write fails loud and emits no proposed bytes for multi-field input', () => {
  const result = run(source, {
    scenario: 'exact-case',
    insert: {
      test: { path: 'spec-eval/src/scenarios.test.ts', name: 'one exact case' },
      runner: 'not-owned-here',
    },
  })
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /exactly one measurement field.*test/i)
})

test('real spex eval scenario write emits no bytes for malformed indentation', () => {
  const cases = [
    {
      name: 'inconsistent sibling scenario fields',
      input: source.replace(
        '      description: >-\r\n        measure one concrete case',
        '        description: measure one concrete case',
      ),
      error: /inconsistent scenario field indentation/i,
    },
    {
      name: 'space-tab block scalar content',
      input: source.replace('        measure one concrete case', '      \tmeasure one concrete case'),
      error: /tab indentation.*block scalar/i,
    },
    {
      name: 'space-tab pseudo-blank block scalar content',
      input: source.replace('        measure one concrete case', '      \t'),
      error: /tab indentation.*block scalar/i,
    },
  ]
  const mutation = { scenario: 'exact-case', insert: { test: 'spec-eval/src/scenarios.test.ts' } }

  for (const fixture of cases) {
    const result = run(fixture.input, mutation)
    assert.notEqual(result.status, 0, fixture.name)
    assert.equal(result.stdout, '', fixture.name)
    assert.match(result.stderr, fixture.error, fixture.name)
  }
})
