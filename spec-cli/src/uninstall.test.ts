import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { writeManagedBlock } from './harness.js'
import { runtimeRoot, mainCheckout } from './layout.js'
import { uninstall } from './uninstall.js'

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
  const prevHome = process.env.SPEXCODE_HOME, prevCodex = process.env.CODEX_HOME
  process.env.SPEXCODE_HOME = home
  process.env.CODEX_HOME = codexHome
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
  }
})

test('uninstall preserves git hooks by default; --hooks removes ONLY spexcode-stamped ones', () => {
  const proj = gitRepo()
  const hooks = join(proj, '.git', 'hooks')
  mkdirSync(hooks, { recursive: true })
  writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\n# @spexcode/spec-cli main-guard\n')   // ours (stamped)
  writeFileSync(join(hooks, 'prepare-commit-msg'), '#!/bin/sh\necho user own hook\n')          // user's (no stamp)
  chmodSync(join(hooks, 'pre-commit'), 0o755)

  // default: both preserved
  uninstall(proj)
  assert.ok(existsSync(join(hooks, 'pre-commit')), 'hooks preserved by default')

  // --hooks: stamped pre-commit removed, the user's unstamped hook survives
  uninstall(proj, { hooks: true })
  assert.ok(!existsSync(join(hooks, 'pre-commit')), 'stamped hook removed under --hooks')
  assert.ok(existsSync(join(hooks, 'prepare-commit-msg')), 'unstamped user hook kept')
})
