import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { mintIds } from '@spexcode/spec-core'

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const hook = fileURLToPath(new URL('../templates/hooks/prepare-commit-msg', import.meta.url))
const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_SESSION_ID: 'commit-context-test' }
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY']) delete env[key]
const source = 'export function first() {\n  return 1\n}\nexport function second() {\n  return 2\n}\n'
const declaration = (id: string, field: string, path: string) => `---\ntitle: ${id}\n${field}:\n  - ${path}\n---\n# ${id}\n\nIntent.\n`

test('canonical suffix counts equal the pairwise mint on the repository and collision/NFC cases', (t) => {
  const specDir = fileURLToPath(new URL('../../.spec', import.meta.url))
  const repoNodes = readdirSync(specDir, { recursive: true }).map(String)
    .filter((path) => path.endsWith('/spec.md')).map((path) => path.split('/').slice(0, -1))
  assert.ok(repoNodes.length > 0)
  t.diagnostic(`full repository mint parity: ${repoNodes.length} nodes`)
  const edgeCases = [[], ['a'], ['b', 'a'], ['c', 'b', 'a'], ['b', 'a'], ['é'], ['e\u0301'],
    ['a_b'], ['c', 'a', 'b'], ['b'], ...Array.from({ length: 256 }, (_, i) => ['root', `${i % 13}`, `${i % 31}`])]
  const suffix = (s: string[], k: number) => s.slice(s.length - k).join('_').normalize('NFC')
  for (const segs of [repoNodes, edgeCases]) {
    const expected = segs.map((s, i) => {
      let k = 1
      while (k < s.length && segs.some((o, j) => j !== i && o.length >= k && suffix(o, k) === suffix(s, k))) k++
      return suffix(s, k)
    })
    assert.deepEqual(mintIds(segs), expected)
  }
})

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'spex-context-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path: string, content: string) => {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const git = (...args: string[]) => {
    const r = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' })
    assert.equal(r.status, 0, `${args.join(' ')}\n${r.stdout}\n${r.stderr}`)
    return r
  }
  git('init', '-q', '-b', 'work')
  git('config', 'user.name', 'Context test')
  git('config', 'user.email', 'context@example.test')
  git('config', 'core.hooksPath', join(root, '.git/hooks'))
  put('f.ts', source)
  put('other.ts', source)
  put('.spec/alpha/spec.md', declaration('alpha', 'code', 'f.ts#first'))
  put('.spec/beta/spec.md', declaration('beta', 'related', 'f.ts#first'))
  put('.spec/gamma/spec.md', declaration('gamma', 'related', 'f.ts'))
  put('.spec/delta/spec.md', declaration('delta', 'related', 'f.ts'))
  put('.spec/other/spec.md', declaration('other', 'code', 'other.ts'))
  git('add', '.')
  git('commit', '-qm', 'seed', '--trailer', 'Session: commit-context-test')
  copyFileSync(hook, join(root, '.git/hooks/prepare-commit-msg'))
  chmodSync(join(root, '.git/hooks/prepare-commit-msg'), 0o755)
  // The same package-local resolution an adopter uses, reaching the built product CLI.
  put('node_modules/.bin/spex', `#!/bin/sh\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${cli.replace(/'/g, "'\\''")}' "$@"\n`)
  chmodSync(join(root, 'node_modules/.bin/spex'), 0o755)
  const message = () => git('log', '-1', '--format=%B').stdout
  return { root, put, git, message }
}

test('real -m commits derive governors, anchored touches, capped context and one trailer paragraph', (t) => {
  const { put, git, message } = fixture(t)
  put('f.ts', source.replace('return 1', 'return 10'))
  git('add', 'f.ts')
  const r = git('commit', '-qm', 'governed change')
  assert.match(r.stderr, /f.ts  governed by \[\[alpha\]\]/)
  assert.match(r.stderr, /touches \[\[alpha\]\]#first, \[\[beta\]\]#first/)
  assert.match(r.stderr, /context: \[\[beta\]\], \[\[delta\]\] \(\+1\)/)
  assert.match(r.stderr, /governed code changed, spec untouched: \[\[alpha\]\] — still true\?/)
  assert.match(message(), /Session: commit-context-test\nSpec: alpha\n/)
  assert.equal(git('log', '-1', '--format=%(trailers:key=Spec,valueonly)').stdout.trim(), 'alpha')
  assert.equal(r.stderr.match(/derived trailer/g)?.length, 1)
})

test('candidate spec and source win over dirty working copies; re-version suppresses the question', (t) => {
  const { put, git, message } = fixture(t)
  put('f.ts', source.replace('return 1', 'return 10'))
  put('.spec/alpha/spec.md', declaration('alpha', 'code', 'f.ts#first') + '\nNew intent.\n')
  git('add', 'f.ts', '.spec/alpha/spec.md')
  put('f.ts', 'this is not valid TypeScript !!!')
  put('.spec/alpha/spec.md', declaration('alpha', 'related', 'unrelated.ts'))
  const r = git('commit', '-qm', 'intent and implementation')
  assert.match(r.stderr, /touches \[\[alpha\]\]#first/)
  assert.match(r.stderr, /re-versions \[\[alpha\]\]/)
  assert.doesNotMatch(r.stderr, /still true|unavailable/)
  assert.match(message(), /^Spec: alpha$/m)
})

test('pathspec, --only empty stamps and amends use the commit index and suppress unchanged trees', (t) => {
  const { put, git, message } = fixture(t)
  put('other.ts', source.replace('return 2', 'return 20'))
  git('add', 'other.ts')
  put('f.ts', source.replace('return 1', 'return 10'))
  const r = git('commit', '-qm', 'pathspec', '--', 'f.ts')
  assert.match(r.stderr, /governed by \[\[alpha\]\]/)
  assert.doesNotMatch(r.stderr, /other/)
  assert.match(message(), /^Spec: alpha$/m)
  const stamp = git('commit', '--only', '--allow-empty', '-qm', 'ack', '--trailer', 'Spec-OK: alpha')
  assert.equal(stamp.stderr, '')
  assert.doesNotMatch(message(), /^Spec:/m)
  assert.match(message(), /Spec-OK: alpha\nSession: commit-context-test/)
  assert.equal(git('diff', '--cached', '--name-only').stdout.trim(), 'other.ts')
  git('reset', '-q', 'HEAD', '--', 'other.ts')
  const amend = git('commit', '--amend', '--allow-empty', '-qm', 'message only')
  assert.equal(amend.stderr, '')
  put('f.ts', source.replace('return 1', 'return 30'))
  git('add', 'f.ts')
  assert.match(git('commit', '--amend', '-qm', 'amend source').stderr, /touches \[\[alpha\]\]#first/)
  assert.match(message(), /^Spec: alpha$/m)
})

test('unclaimed paths and handwritten trailers remain honest, including quoted filenames and deletions', (t) => {
  const { put, git, message } = fixture(t)
  const path = 'odd "file\tname.txt'
  put(path, 'unclaimed\n')
  git('add', '--', path)
  assert.ok(git('commit', '-qm', 'unclaimed').stderr.includes(`${path}  (unclaimed — coverage)`))
  assert.doesNotMatch(message(), /^Spec:/m)
  put('f.ts', source.replace('return 1', 'return 11'))
  git('add', 'f.ts')
  const r = git('commit', '-qm', 'handwritten\n\nSpec: beta,  alpha\nSession: hand-set')
  assert.doesNotMatch(r.stderr, /derived trailer/)
  assert.match(message(), /^Spec: beta,  alpha\nSession: hand-set$/m)
  git('rm', 'f.ts')
  const deletion = git('commit', '-qm', 'delete source')
  assert.match(deletion.stderr, /governed by \[\[alpha\]\]/)
  assert.doesNotMatch(deletion.stderr, /touches|unavailable/)
})

test('merge commits get Session but no context or derived Spec', (t) => {
  const { put, git, message } = fixture(t)
  git('checkout', '-qb', 'side')
  put('f.ts', source.replace('return 1', 'return 10'))
  git('add', 'f.ts')
  git('commit', '-qm', 'side change')
  git('checkout', '-q', 'work')
  const r = git('merge', '--no-ff', 'side', '-m', 'merge side')
  assert.equal(r.stderr, '')
  assert.doesNotMatch(message(), /^Spec:/m)
  assert.match(message(), /^Session: commit-context-test$/m)
})

test('a resolved but older or failed CLI reports one advisory and Session still stamps under set -e', (t) => {
  const { root, put, git, message } = fixture(t)
  put('node_modules/.bin/spex', '#!/bin/sh\necho "unknown verb" >&2\nexit 2\n')
  put('f.ts', source.replace('return 1', 'return 10'))
  git('add', 'f.ts')
  const r = git('commit', '-qm', 'old CLI')
  assert.match(r.stderr, /^• SpexCode: commit context unavailable \(unknown verb\) — advisory, commit proceeds\n$/)
  assert.match(message(), /^Session: commit-context-test$/m)
  assert.doesNotMatch(message(), /^Spec:/m)
  assert.ok(readFileSync(join(root, '.git/hooks/prepare-commit-msg'), 'utf8').includes('set -euo pipefail'))
})
