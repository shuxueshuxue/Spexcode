import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mainCheckout, runtimeRoot, resolveLayout, encodeProject, gitInterpretationIdentity } from '@spexcode/spec-core'
import { browseProjectDirectories, addKnownProject } from './host.js'

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..')
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()

test('submodule layout, stores, catalog, hooks and adoption use the primary checkout', async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'spex-submodule-layout-'))
  const previousCwd = process.cwd(), previousHome = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = join(base, 'home')
  t.after(() => {
    process.chdir(previousCwd)
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    rmSync(base, { recursive: true, force: true })
  })
  function repo(name: string, separate = false) {
    const root = join(base, name)
    mkdirSync(root)
    git(root, 'init', '-q', '-b', 'module-main', ...(separate ? ['--separate-git-dir', join(base, `${name}-metadata`)] : []))
    if (separate) git(root, 'config', 'core.worktree', root)
    git(root, 'config', 'user.name', 'Test')
    git(root, 'config', 'user.email', 'test@example.invalid')
    writeFileSync(join(root, 'README.md'), 'fixture\n')
    git(root, 'add', '.'); git(root, 'commit', '-qm', 'fixture')
    return root
  }
  const parent = repo('parent'), source = repo('source')
  git(parent, 'branch', '-m', 'parent-main')
  const roots = ['module one', 'module-two'].map((name) => {
    git(parent, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source, name)
    return join(parent, name)
  })
  roots.push(repo('ordinary'), repo('separate', true))
  const shell = (cwd: string, fn: string) => execFileSync('bash', ['-c', 'source "$1"; "$2"', 'bash', join(pkg, 'hooks/harness.sh'), fn], { cwd, encoding: 'utf8' }).trim()
  const stores: string[] = []
  for (const root of roots) {
    mkdirSync(join(root, '.spec/project'), { recursive: true })
    writeFileSync(join(root, '.spec/project/spec.md'), '---\ntitle: fixture\nstatus: active\n---\n# fixture\n')
    const config = join(root, '.spec/spexcode.json')
    writeFileSync(config, JSON.stringify({ mainBranch: 'module-main', branchPrefix: 'custom/' }))
    git(root, 'add', '.spec'); git(root, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'spec')
    const linked = join(base, `linked-${roots.indexOf(root)}`)
    git(root, 'worktree', 'add', '-qb', `linked-${roots.indexOf(root)}`, linked)
    await t.test(`identity and config: ${root}`, async () => {
      const expected = join(process.env.SPEXCODE_HOME!, 'projects', encodeProject(root))
      for (const cwd of [root, linked]) {
        process.chdir(cwd)
        assert.equal(mainCheckout(), root)
        assert.equal(runtimeRoot(), expected)
        assert.equal(shell(cwd, 'hp_runtime_dir'), expected)
        assert.equal(browseProjectDirectories(cwd).gitRoot, root)
        assert.equal(browseProjectDirectories(cwd).initialized, true)
        assert.equal(addKnownProject(cwd), root)
        const layout = await resolveLayout()
        assert.equal(layout.convention.branchPrefix, 'custom/')
        assert.equal(layout.main, root)
        assert.equal(gitInterpretationIdentity(cwd), gitInterpretationIdentity(root))
      }
      const before = shell(linked, 'hp_config_hash')
      writeFileSync(config, JSON.stringify({ mainBranch: 'module-main', branchPrefix: 'changed/' }))
      assert.notEqual(shell(linked, 'hp_config_hash'), before)
      const graph = execFileSync(process.execPath, [join(pkg, 'bin/spex.mjs'), 'graph', '--json'], { cwd: root, encoding: 'utf8' })
      assert.ok(JSON.parse(graph))
      stores.push(runtimeRoot(root))
    })
  }
  await t.test('each project owns a distinct runtime store', () => assert.equal(new Set(stores).size, roots.length))
  await t.test('full init stamps the submodule branch', () => {
    const root = roots[1]
    rmSync(join(root, '.spec'), { recursive: true })
    execFileSync(process.execPath, [join(pkg, 'bin/spex.mjs'), 'init', '.', '--harness', 'claude'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, SPEXCODE_HOME: join(base, 'init-home') },
    })
    assert.equal(JSON.parse(readFileSync(join(root, '.spec/spexcode.json'), 'utf8')).mainBranch, 'module-main')
  })
})
