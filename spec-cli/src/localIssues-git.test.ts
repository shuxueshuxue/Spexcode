import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const storeUrl = new URL('./localIssues.ts', import.meta.url).href
const coreUrl = new URL('../../packages/spec-core/src/layout.ts', import.meta.url).href
const loader = import.meta.resolve('tsx')

function run(cwd: string, body: string) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_') || key === 'SPEXCODE_ISSUES_DIR') delete env[key]
  }
  return spawnSync(process.execPath, ['--import', loader, '--input-type=module', '-e', body], {
    cwd, env, encoding: 'utf8', timeout: 15000,
  })
}

function fixture(kind: 'ordinary' | 'submodule' | 'separate', fn: (root: string, dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'spex-issues-git-'))
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  const init = (root: string, separate?: string) => {
    mkdirSync(root, { recursive: true })
    git(root, 'init', '-q', '-b', 'main', ...(separate ? ['--separate-git-dir', separate] : []))
    git(root, 'config', 'user.name', 'Test')
    git(root, 'config', 'user.email', 'test@example.invalid')
    git(root, 'config', 'commit.gpgsign', 'false')
    if (separate) git(root, 'config', 'core.worktree', root)
    writeFileSync(join(root, 'README.md'), 'fixture\n')
    git(root, 'add', 'README.md')
    git(root, 'commit', '-qm', 'init')
  }
  try {
    let root = join(dir, 'root')
    if (kind === 'submodule') {
      const source = join(dir, 'source')
      init(source)
      init(root)
      git(root, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source, 'module')
      git(root, 'commit', '-qam', 'add module')
      root = join(root, 'module')
      git(root, 'config', 'user.name', 'Test')
      git(root, 'config', 'user.email', 'test@example.invalid')
      git(root, 'config', 'commit.gpgsign', 'false')
    } else init(root, kind === 'separate' ? join(dir, 'metadata') : undefined)
    fn(root, dir)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

for (const kind of ['ordinary', 'submodule', 'separate'] as const) {
  test(`local issues commit open/reply/close in a ${kind} checkout`, () => fixture(kind, (root) => {
    writeFileSync(join(root, 'unrelated.txt'), 'keep staged\n')
    execFileSync('git', ['add', 'unrelated.txt'], { cwd: root })
    const result = run(root, `
      import assert from 'node:assert/strict';
      import { openIssue, reply, closeLocalIssue, loadOne } from ${JSON.stringify(storeUrl)};
      const issue = openIssue('lock regression', { body: 'initial', author: 'test' });
      reply(issue.id, 'reply persisted', 'test');
      assert.equal(loadOne(issue.id).replies[0].body, 'reply persisted');
      closeLocalIssue(issue.id);
      assert.equal(loadOne(issue.id).status, 'landed');
    `)
    assert.equal(result.status, 0, result.stderr || String(result.error))
    assert.equal(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), '4')
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), 'A  unrelated.txt')
  }))

  test(`local issues refuse linked writes and resolve the ${kind} primary checkout`, () => fixture(kind, (root, dir) => {
    const linked = join(dir, 'linked')
    execFileSync('git', ['worktree', 'add', '-q', '--detach', linked], { cwd: root })
    for (const cwd of [root, linked]) {
      const result = run(cwd, `
        import assert from 'node:assert/strict';
        import { mainCheckout } from ${JSON.stringify(coreUrl)};
        assert.equal(mainCheckout(), ${JSON.stringify(root)});
        assert.equal(mainCheckout(${JSON.stringify(cwd)}), ${JSON.stringify(root)});
      `)
      assert.equal(result.status, 0, result.stderr || String(result.error))
    }
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim()
    const lock = join(common, 'spexcode-forum.lock')
    mkdirSync(lock)
    const result = run(linked, `
      import assert from 'node:assert/strict';
      import { openIssue } from ${JSON.stringify(storeUrl)};
      assert.throws(() => openIssue('must refuse'), /refusing to write a local issue.*linked worktree/);
    `)
    assert.equal(result.status, 0, result.stderr || String(result.error))
    assert.equal(existsSync(lock), true, 'a rejected linked writer never acquires or removes another writer\'s lock')
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }), before)
    assert.equal(existsSync(join(root, '.spec', '.issues')), false)
  }))

  test(`local issues migrate the legacy store in a ${kind} checkout`, () => fixture(kind, (root) => {
    const legacy = join(root, '.spec', '.forum')
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, 'legacy.md'), '---\nconcern: legacy\nby: test\nstatus: open\ncreated: 2026-01-01T00:00:00Z\n---\n\nOriginal body.\n')
    execFileSync('git', ['add', '.spec'], { cwd: root })
    execFileSync('git', ['commit', '-qm', 'legacy store'], { cwd: root })
    const result = run(root, `
      import assert from 'node:assert/strict';
      import { loadOne } from ${JSON.stringify(storeUrl)};
      assert.equal(loadOne('legacy').body, 'Original body.');
    `)
    assert.equal(result.status, 0, result.stderr || String(result.error))
    assert.equal(existsSync(legacy), false)
    assert.equal(existsSync(join(root, '.spec', '.issues', 'legacy.md')), true)
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), '')
  }))
}
