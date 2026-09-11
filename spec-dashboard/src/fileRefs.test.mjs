import test from 'node:test'
import assert from 'node:assert/strict'
import { FILE_REF_RE, resolveFileRef } from './fileRefs.js'

const posted = ['/ev/copy/report.html', '/ev/copy/before.png', '/ev/other/before.png', '/root.txt']

test('a file reference resolves by name or by as much of its path as tells it apart', () => {
  assert.deepEqual(resolveFileRef('report.html', posted), { path: '/ev/copy/report.html', matches: 1 })
  assert.deepEqual(resolveFileRef('other/before.png', posted), { path: '/ev/other/before.png', matches: 1 })
  assert.deepEqual(resolveFileRef('/ev/copy/before.png', posted), { path: '/ev/copy/before.png', matches: 1 })
  assert.deepEqual(resolveFileRef('root.txt', posted), { path: '/root.txt', matches: 1 })
})

test('an ambiguous or unknown name resolves to nothing and says how many answered', () => {
  assert.deepEqual(resolveFileRef('before.png', posted), { path: null, matches: 2 })
  assert.deepEqual(resolveFileRef('missing.md', posted), { path: null, matches: 0 })
  // a name is a whole path segment, never the tail of one
  assert.deepEqual(resolveFileRef('port.html', posted), { path: null, matches: 0 })
  assert.deepEqual(resolveFileRef('   ', posted), { path: null, matches: 0 })
})

test('the reference grammar is the typed [[file:…]] form and never a bare node reference', () => {
  const line = 'see [[file:report.html]] and [[copy-control]], then [[file:other/before.png]]'
  assert.deepEqual([...line.matchAll(FILE_REF_RE)].map((match) => match[1]), ['report.html', 'other/before.png'])
})
