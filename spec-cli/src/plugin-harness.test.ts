import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { emitPlugin, cleanPlugin, pluginBundleDir } from './plugin-harness.js'

const BUNDLE = {
  contract: 'GUIDE\n\nSYSTEM CONTRACT "with quotes"\nand a newline',
  skills: [{ name: 'taste', content: '---\nname: taste\n---\nbody\n' }],
  agents: [{ name: 'spec-scout', content: '---\nname: spec-scout\n---\nagent\n' }],
  commands: [{ name: 'tidy', content: '---\ndescription: "tidy"\n---\n\ntidy body\n' }],
  spex: '/abs/tsx /abs/cli.ts',
  version: '9.9.9',
}

test('emitPlugin writes a self-contained Claude-plugin bundle under <folder>/plugins/spexcode', () => {
  const proj = mkdtempSync(join(tmpdir(), 'spex-plug-'))
  emitPlugin(proj, '.zcode', BUNDLE)
  const bundle = pluginBundleDir(proj, '.zcode')
  assert.equal(bundle, join(proj, '.zcode', 'plugins', 'spexcode'))

  // manifest: identity + version + component pointers
  const manifest = JSON.parse(readFileSync(join(bundle, '.claude-plugin', 'plugin.json'), 'utf8'))
  assert.equal(manifest.name, 'spexcode')
  assert.equal(manifest.version, '9.9.9')
  assert.equal(manifest.hooks, './hooks/hooks.json')
  assert.equal(manifest.skills, './skills')
  assert.equal(manifest.commands, './commands')
  assert.equal(manifest.agents, './agents')

  // hooks.json: Claude/z-code shape, every event → dispatch.sh with the `plugin` harness id via ${CLAUDE_PLUGIN_ROOT}
  const hooks = JSON.parse(readFileSync(join(bundle, 'hooks', 'hooks.json'), 'utf8')).hooks
  const stop = hooks.Stop[0].hooks[0].command
  assert.match(stop, /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/dispatch\.sh" plugin Stop$/)
  assert.match(stop, /^SPEX='\/abs\/tsx \/abs\/cli\.ts' bash /)
  // SessionStart ALSO runs the contract injector FIRST, then dispatch
  const ss = hooks.SessionStart[0].hooks
  assert.match(ss[0].command, /inject-contract\.sh"$/)
  assert.match(ss[1].command, /dispatch\.sh" plugin SessionStart$/)

  // contract → additionalContext, JSON-encoded at materialize time (arbitrary prose, quotes + newlines, survives)
  const ctx = JSON.parse(readFileSync(join(bundle, 'hooks', 'contract-context.json'), 'utf8'))
  assert.equal(ctx.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.equal(ctx.hookSpecificOutput.additionalContext, BUNDLE.contract)

  // the shared dispatcher + its shell mirror are copied verbatim into the bundle (dispatch sources harness.sh as a sibling)
  assert.ok(readFileSync(join(bundle, 'hooks', 'dispatch.sh'), 'utf8').includes('SPEXCODE_HARNESS'))
  assert.ok(existsSync(join(bundle, 'hooks', 'harness.sh')))
  assert.ok(readFileSync(join(bundle, 'hooks', 'inject-contract.sh'), 'utf8').includes('contract-context.json'))

  // skills / agents / commands in the Claude-plugin layout
  assert.ok(readFileSync(join(bundle, 'skills', 'taste', 'SKILL.md'), 'utf8').includes('name: taste'))
  assert.ok(readFileSync(join(bundle, 'agents', 'spec-scout.md'), 'utf8').includes('agent'))
  assert.ok(readFileSync(join(bundle, 'commands', 'tidy.md'), 'utf8').includes('tidy body'))
})

test('emitPlugin is idempotent — re-emitting overwrites in place', () => {
  const proj = mkdtempSync(join(tmpdir(), 'spex-plug2-'))
  emitPlugin(proj, '.claude', BUNDLE)
  emitPlugin(proj, '.claude', { ...BUNDLE, version: '1.2.3' })
  const manifest = JSON.parse(readFileSync(join(pluginBundleDir(proj, '.claude'), '.claude-plugin', 'plugin.json'), 'utf8'))
  assert.equal(manifest.version, '1.2.3')
})

test('cleanPlugin removes OUR bundle only — identity-gated on plugin.json name', () => {
  const proj = mkdtempSync(join(tmpdir(), 'spex-plug3-'))
  emitPlugin(proj, '.zcode', BUNDLE)
  assert.ok(existsSync(pluginBundleDir(proj, '.zcode')))
  cleanPlugin(proj, '.zcode')
  assert.ok(!existsSync(pluginBundleDir(proj, '.zcode')))
})

test('cleanPlugin spares a foreign (non-spexcode) bundle at the same path', () => {
  const proj = mkdtempSync(join(tmpdir(), 'spex-plug4-'))
  const bundle = pluginBundleDir(proj, '.zcode')
  mkdirSync(join(bundle, '.claude-plugin'), { recursive: true })
  writeFileSync(join(bundle, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'someone-elses-plugin' }))
  cleanPlugin(proj, '.zcode')
  assert.ok(existsSync(join(bundle, '.claude-plugin', 'plugin.json')))   // untouched — not ours
})

test('cleanPlugin is a no-op when nothing is there', () => {
  const proj = mkdtempSync(join(tmpdir(), 'spex-plug5-'))
  cleanPlugin(proj, '.zcode')   // must not throw
  assert.ok(!existsSync(pluginBundleDir(proj, '.zcode')))
})
