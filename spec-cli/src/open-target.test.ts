import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { resolveOpenTarget } from './open-target.js'
import type { Session } from './sessions.js'

function session(id: string, branch: string): Session {
  return {
    id, branch, path: '/fixture', label: id, title: id, raw: { name: null, title: null }, parent: null,
    harness: 'codex', capabilities: { headless: false }, launcher: 'codex', lifecycle: 'active', proposal: null,
    merges: 0, status: 'working', liveness: 'unknown', note: null, archived: false, closedAt: null,
    prompt: null, promptPreview: null, created: 1, activity: null, sortKey: null,
  }
}

test('resolves nodes before sessions and files into canonical dashboard hashes', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-open-target-'))
  try {
    writeFileSync(join(root, 'same'), 'file')
    const target = resolveOpenTarget('same', {
      root,
      specs: [{ id: 'same' }],
      sessions: [session('same-session', 'same')],
      cwd: root,
    })
    assert.deepEqual(target, { kind: 'node', id: 'same', hash: '#/spec/same' })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('resolves session selectors to their full id', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-open-target-'))
  try {
    const target = resolveOpenTarget('abc123', {
      root,
      specs: [],
      sessions: [session('abc12345-0000-0000-0000-000000000000', 'node/example')],
      cwd: root,
    })
    assert.deepEqual(target, {
      kind: 'session',
      id: 'abc12345-0000-0000-0000-000000000000',
      hash: '#/sessions/abc12345-0000-0000-0000-000000000000',
    })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('resolves a project file and refuses paths outside the project', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-open-target-'))
  const outside = mkdtempSync(join(tmpdir(), 'spex-open-outside-'))
  try {
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'hello world.ts'), '')
    writeFileSync(join(outside, 'secret'), '')
    assert.deepEqual(resolveOpenTarget('hello world.ts', { root, specs: [], sessions: [], cwd: join(root, 'src') }), {
      kind: 'file', path: 'src/hello world.ts', hash: '#/file/src/hello%20world.ts',
    })
    assert.throws(() => resolveOpenTarget(join(outside, 'secret'), { root, specs: [], sessions: [], cwd: root }), /outside the project/)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('fails loudly for an ambiguous session selector or missing file', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-open-target-'))
  try {
    const sessions = [session('abc11111-0000-0000-0000-000000000000', 'node/one'), session('abc22222-0000-0000-0000-000000000000', 'node/two')]
    assert.throws(() => resolveOpenTarget('abc', { root, specs: [], sessions, cwd: root }), /ambiguous/)
    assert.throws(() => resolveOpenTarget('missing', { root, specs: [], sessions: [], cwd: root }), /not a file/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
