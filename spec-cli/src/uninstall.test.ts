import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, chmodSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { writeManagedBlock } from './harness.js'
import { runtimeRoot, mainCheckout } from './layout.js'
import { uninstall } from './uninstall.js'

const CLI = fileURLToPath(new URL('../bin/spex.mjs', import.meta.url))
const HOOK_TEMPLATES = fileURLToPath(new URL('../templates/hooks', import.meta.url))

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spex-uninstall-'))
  execFileSync('git', ['-C', dir, 'init', '-q'])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 't'])
  return dir
}

test('uninstall surgically removes the SpexCode footprint, never the user data', () => {
  const home = mkdtempSync(join(tmpdir(), 'spexhome-'))
  const codexHome = mkdtempSync(join(tmpdir(), 'codexhome-'))
  const proj = gitRepo()
  const prevHome = process.env.SPEXCODE_HOME, prevCodex = process.env.CODEX_HOME, prevPi = process.env.SPEXCODE_PI_AGENT_DIR
  process.env.SPEXCODE_HOME = home
  process.env.CODEX_HOME = codexHome
  process.env.SPEXCODE_PI_AGENT_DIR = mkdtempSync(join(tmpdir(), 'pihome-'))
  try {
    // --- the user's OWN data + prose (all must survive) ---
    mkdirSync(join(proj, '.spec', 'x'), { recursive: true })
    writeFileSync(join(proj, '.spec', 'x', 'spec.md'), '# user spec\n')
    mkdirSync(join(proj, '.config'), { recursive: true })
    writeFileSync(join(proj, '.config', 'note.md'), 'user config\n')
    writeFileSync(join(proj, 'CLAUDE.md'), '# My notes\nkeep me\n')          // user prose + our block
    writeManagedBlock(join(proj, 'CLAUDE.md'), 'CONTRACT')
    writeFileSync(join(proj, '.gitignore'), 'node_modules/\n')               // user entry + our block
    writeManagedBlock(join(proj, '.gitignore'), 'CLAUDE.md', ['# ', ''])

    // --- the SpexCode-generated footprint (all must go) ---
    writeManagedBlock(join(proj, 'AGENTS.md'), 'CONTRACT')                   // WHOLLY ours → deleted
    mkdirSync(join(proj, '.claude'), { recursive: true })
    writeFileSync(join(proj, '.claude', 'settings.json'), 'bash /x/dispatch.sh claude Stop')  // our shim stamp
    // global per-project store
    const store = runtimeRoot(proj)
    mkdirSync(store, { recursive: true })
    writeFileSync(join(store, 'content-hash'), 'abc')
    // codex trust block in the GLOBAL config (+ a foreign key that must survive). The block is keyed by the
    // MAIN checkout path — the SAME key removeTrust strips by — so the round-trip matches regardless of any
    // /tmp symlink normalization.
    const mc = mainCheckout(proj)
    writeFileSync(join(codexHome, 'config.toml'), `[user]\nkeep = 1\n\n# spexcode:trust:${mc} (managed — do not edit)\ntrust_level = "trusted"\n# spexcode:trust:end:${mc}\n`)
    // a spexcode plugin bundle (folder-name stamp) + a foreign plugin (must survive)
    mkdirSync(join(proj, '.claude', 'plugins', 'spexcode'), { recursive: true })
    writeFileSync(join(proj, '.claude', 'plugins', 'spexcode', 'x'), '1')
    mkdirSync(join(proj, '.claude', 'plugins', 'userplugin', '.claude-plugin'), { recursive: true })
    writeFileSync(join(proj, '.claude', 'plugins', 'userplugin', '.claude-plugin', 'plugin.json'), '{"name":"userplugin"}')
    // a renamed bundle that declares name==spexcode in its manifest (manifest stamp)
    mkdirSync(join(proj, '.codex', 'plugins', 'renamed', '.claude-plugin'), { recursive: true })
    writeFileSync(join(proj, '.codex', 'plugins', 'renamed', '.claude-plugin', 'plugin.json'), '{"name":"spexcode"}')

    uninstall(proj)

    // user data untouched
    assert.ok(existsSync(join(proj, '.spec', 'x', 'spec.md')), '.spec preserved')
    assert.ok(existsSync(join(proj, '.config', 'note.md')), '.config preserved')
    // CLAUDE.md: block stripped, prose kept
    const claude = readFileSync(join(proj, 'CLAUDE.md'), 'utf8')
    assert.ok(claude.includes('keep me') && !claude.includes('CONTRACT'), 'CLAUDE.md prose kept, block gone')
    // AGENTS.md: wholly ours → deleted
    assert.ok(!existsSync(join(proj, 'AGENTS.md')), 'wholly-ours AGENTS.md deleted')
    // .gitignore: block gone, user entry kept
    const gi = readFileSync(join(proj, '.gitignore'), 'utf8')
    assert.ok(gi.includes('node_modules/') && !gi.includes('CLAUDE.md'), '.gitignore user entry kept, block gone')
    // shim gone, store gone, trust gone (foreign key kept)
    assert.ok(!existsSync(join(proj, '.claude', 'settings.json')), 'stamped shim removed')
    assert.ok(!existsSync(store), 'global store removed')
    const toml = readFileSync(join(codexHome, 'config.toml'), 'utf8')
    assert.ok(toml.includes('keep = 1') && !toml.includes('spexcode:trust'), 'codex trust block removed, user key kept')
    // plugin bundles: spexcode (folder + manifest stamp) gone, foreign kept
    assert.ok(!existsSync(join(proj, '.claude', 'plugins', 'spexcode')), 'folder-stamped bundle removed')
    assert.ok(!existsSync(join(proj, '.codex', 'plugins', 'renamed')), 'manifest-stamped bundle removed')
    assert.ok(existsSync(join(proj, '.claude', 'plugins', 'userplugin')), 'foreign plugin kept')
  } finally {
    process.env.SPEXCODE_HOME = prevHome
    process.env.CODEX_HOME = prevCodex
    process.env.SPEXCODE_PI_AGENT_DIR = prevPi
  }
})

test('public init → uninstall --hooks removes exact generated hooks and preserves every user byte', () => {
  const proj = gitRepo()
  const home = mkdtempSync(join(tmpdir(), 'spexhome-'))
  const codexHome = mkdtempSync(join(tmpdir(), 'codexhome-'))
  const piHome = mkdtempSync(join(tmpdir(), 'pihome-'))
  const env = { ...process.env, HOME: home, SPEXCODE_HOME: home, CODEX_HOME: codexHome, SPEXCODE_PI_AGENT_DIR: piHome }
  const hooks = join(proj, '.git', 'hooks')
  const prose = '# Team notes\nkeep me\n'
  writeFileSync(join(proj, 'CLAUDE.md'), prose)

  const spex = (...args: string[]) => execFileSync(process.execPath, [CLI, ...args], {
    cwd: proj,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  spex('init', '.', '--harness', 'claude')

  const generated = readdirSync(HOOK_TEMPLATES).sort()
  assert.deepEqual(generated, ['post-checkout', 'post-merge', 'pre-commit', 'prepare-commit-msg'])
  for (const name of generated) {
    assert.ok(readFileSync(join(hooks, name)).equals(readFileSync(join(HOOK_TEMPLATES, name))), `${name} installed byte-identically`)
  }

  spex('uninstall', '.')
  for (const name of generated) assert.ok(existsSync(join(hooks, name)), `${name} preserved without --hooks`)

  const modifiedName = 'prepare-commit-msg'
  const modified = Buffer.concat([readFileSync(join(hooks, modifiedName)), Buffer.from('\n# user modification\n')])
  writeFileSync(join(hooks, modifiedName), modified)
  const unrelatedName = 'post-rewrite'
  const unrelated = '#!/bin/sh\nprintf user-hook\\n\n'
  writeFileSync(join(hooks, unrelatedName), unrelated)
  chmodSync(join(hooks, unrelatedName), 0o755)

  spex('uninstall', '.', '--hooks')

  for (const name of generated.filter((name) => name !== modifiedName)) {
    assert.ok(!existsSync(join(hooks, name)), `exact generated ${name} removed`)
  }
  assert.ok(readFileSync(join(hooks, modifiedName)).equals(modified), 'modified generated hook preserved byte-for-byte')
  assert.equal(readFileSync(join(hooks, unrelatedName), 'utf8'), unrelated, 'unrelated user hook preserved byte-for-byte')
  assert.equal(readFileSync(join(proj, 'CLAUDE.md'), 'utf8'), prose, 'materialized block removed at the exact user-prose boundary')
  assert.ok(existsSync(join(proj, '.spec', 'project', 'spec.md')), 'user spec asset survives the lifecycle')

  const second = spex('uninstall', '.', '--hooks')
  assert.match(second, /no spexcode git hooks to remove/, 'second --hooks run reports an empty clean no-op')
  assert.doesNotMatch(second, /removed git hooks \(/, 'second --hooks run reports no removal set')
  for (const name of generated.filter((name) => name !== modifiedName)) {
    assert.ok(!existsSync(join(hooks, name)), `second run leaves generated ${name} absent`)
  }
  assert.ok(readFileSync(join(hooks, modifiedName)).equals(modified), 'second run keeps the modified generated hook')
  assert.equal(readFileSync(join(hooks, unrelatedName), 'utf8'), unrelated, 'second run keeps the unrelated user hook')
  assert.equal(readFileSync(join(proj, 'CLAUDE.md'), 'utf8'), prose, 'second run keeps user prose')
  assert.ok(existsSync(join(proj, '.spec', 'project', 'spec.md')), 'second run keeps the user spec asset')
})
