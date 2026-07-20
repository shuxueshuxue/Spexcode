import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const CLI = fileURLToPath(new URL('../bin/spex.mjs', import.meta.url))
const HOOK_TEMPLATES = fileURLToPath(new URL('../templates/hooks', import.meta.url))
const GENERATED_MARK = '<!-- spexcode:generated -->'

type HarnessCase = {
  id: 'claude' | 'codex'
  contract: 'CLAUDE.md' | 'AGENTS.md'
  home: '.claude' | '.codex'
  shim: string
  skill: string
  agent: string | null
}

const CASES: HarnessCase[] = [
  {
    id: 'claude',
    contract: 'CLAUDE.md',
    home: '.claude',
    shim: '.claude/settings.json',
    skill: '.claude/skills/distill/SKILL.md',
    agent: '.claude/agents/audit-helper.md',
  },
  {
    id: 'codex',
    contract: 'AGENTS.md',
    home: '.codex',
    shim: '.codex/hooks.json',
    skill: '.codex/skills/distill/SKILL.md',
    agent: null,
  },
]

function gitRepo(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main'])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test User'])
  return dir
}

function snapshotTree(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) out[relative(root, path)] = readFileSync(path).toString('base64')
    }
  }
  walk(root)
  return out
}

function filesNamed(root: string, name: string): string[] {
  if (!existsSync(root)) return []
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name === name) found.push(path)
    }
  }
  walk(root)
  return found
}

function writePlugin(proj: string, host: string, dirName: string, name: string): string {
  const bundle = join(proj, host, 'plugins', dirName)
  mkdirSync(join(bundle, '.claude-plugin'), { recursive: true })
  writeFileSync(join(bundle, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }) + '\n')
  return bundle
}

test('init → materialize → uninstall forgets every derived artifact for Claude-only and Codex-only repos', async () => {
  const help = execFileSync(process.execPath, [CLI, 'uninstall', '--help'], { encoding: 'utf8' })
  assert.match(help, /remove all derived artifacts \+ local state; preserve tracked intent/)
  assert.match(help, /\.spec including \.plugins, plus spexcode\.json/)
  assert.match(help, /--hooks; that flag removes only unmodified canonical copies/)

  for (const row of CASES) {
    const proj = gitRepo(`spex-uninstall-${row.id}-`)
    const userHome = mkdtempSync(join(tmpdir(), `spex-user-${row.id}-`))
    const spexHome = join(userHome, '.spexcode')
    const codexHome = join(userHome, '.codex-global')
    const piHome = join(userHome, '.pi-agent')
    const env = {
      ...process.env,
      HOME: userHome,
      SPEXCODE_HOME: spexHome,
      CODEX_HOME: codexHome,
      SPEXCODE_PI_AGENT_DIR: piHome,
    }
    const g = (...args: string[]) => execFileSync('git', ['-C', proj, ...args], { encoding: 'utf8', env })
    const spex = (...args: string[]) => execFileSync(process.execPath, [CLI, ...args], {
      cwd: proj,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // The host predates SpexCode. All of these bytes are user-owned and tracked.
    const userFiles = {
      'CLAUDE.md': '# Claude team notes\nkeep claude prose\n',
      'AGENTS.md': '# Agent team notes\nkeep agent prose\n',
      '.gitignore': 'node_modules/\ndist/\n',
      'README.md': `# ${row.id} host\n`,
    }
    for (const [path, content] of Object.entries(userFiles)) writeFileSync(join(proj, path), content)
    const excludePath = join(proj, '.git', 'info', 'exclude')
    const attributesPath = join(proj, '.git', 'info', 'attributes')
    writeFileSync(excludePath, 'user-local/\n')
    writeFileSync(attributesPath, '*.txt text\n')
    const codexConfig = join(codexHome, 'config.toml')
    mkdirSync(codexHome, { recursive: true })
    const userCodexConfig = '[user]\nkeep = true\n'
    writeFileSync(codexConfig, userCodexConfig)
    g('add', '-A')
    g('commit', '-qm', 'host before adoption')

    // Real adoption, followed by a user-authored tracked agent plugin and a real explicit re-materialize.
    spex('init', '.', '--harness', row.id)
    const agentNode = join(proj, '.spec', 'project', '.plugins', 'agents', 'audit-helper')
    mkdirSync(agentNode, { recursive: true })
    writeFileSync(join(agentNode, 'spec.md'), `---
title: audit-helper
status: active
surface: agent
desc: Review a change without modifying it.
tools:
  - Read
---
# audit-helper

Read the requested change and report concrete findings.
`)
    g('add', '.spec', 'spexcode.json')
    g('commit', '-qm', 'adopt tracked intent', '--no-verify')
    spex('materialize')

    const specBefore = snapshotTree(join(proj, '.spec'))
    const configBefore = readFileSync(join(proj, 'spexcode.json'))
    assert.ok(readFileSync(join(proj, row.contract), 'utf8').includes('spexcode:start'), `${row.id}: contract materialized into pre-existing prose`)
    assert.ok(existsSync(join(proj, row.shim)), `${row.id}: shim materialized`)
    assert.ok(existsSync(join(proj, row.skill)), `${row.id}: skill materialized`)
    if (row.agent) assert.ok(existsSync(join(proj, row.agent)), 'claude: agent materialized from tracked plugin intent')
    else assert.ok(!existsSync(join(proj, row.home, 'agents')), 'codex: adapter declares no agent primitive')

    const projectStores = readdirSync(join(spexHome, 'projects'))
    assert.equal(projectStores.length, 1, `${row.id}: one per-project runtime root`)
    const store = join(spexHome, 'projects', projectStores[0])
    const manifests = filesNamed(store, 'hooks-manifest')
    const hashes = filesNamed(store, 'content-hash')
    const ledgers = filesNamed(store, 'plugin-folders')
    assert.ok(manifests.length && hashes.length && ledgers.length, `${row.id}: materialize wrote manifest, hash, and plugin ledger`)

    // Dirty products model interrupted migrations and prior policies. Identity stamps, not current policy, must
    // drive forgetting; user-owned siblings at every open landing point are the negative controls.
    const legacySkill = join(proj, row.skill)
    writeFileSync(legacySkill, readFileSync(legacySkill, 'utf8').replace(GENERATED_MARK, ''))
    const staleSkill = join(proj, row.home, 'skills', 'renamed-away', 'SKILL.md')
    mkdirSync(join(staleSkill, '..'), { recursive: true })
    writeFileSync(staleSkill, `stale generated skill\n${GENERATED_MARK}\n`)
    const userSkill = join(proj, row.home, 'skills', 'user-owned', 'SKILL.md')
    mkdirSync(join(userSkill, '..'), { recursive: true })
    writeFileSync(userSkill, 'user skill: keep exactly\n')
    const userSettings = join(proj, row.home, 'user-settings.json')
    writeFileSync(userSettings, '{"keep":true}\n')
    if (row.agent) {
      const legacyAgent = join(proj, row.agent)
      writeFileSync(legacyAgent, readFileSync(legacyAgent, 'utf8').replace(GENERATED_MARK, ''))
      writeFileSync(join(proj, row.home, 'agents', 'renamed-away.md'), `stale generated agent\n${GENERATED_MARK}\n`)
      writeFileSync(join(proj, row.home, 'agents', 'user-owned.md'), 'user agent: keep exactly\n')
    }

    writeFileSync(join(proj, '.gitignore'), `${userFiles['.gitignore'].trimEnd()}\n\n# spexcode:start\nlegacy-artifact\n# spexcode:end\n`)
    g('update-index', '--skip-worktree', '--', row.contract)
    assert.match(g('ls-files', '-v', '--', row.contract), /^S /, `${row.id}: realistic legacy skip-worktree bit planted`)

    mkdirSync(join(store, 'sessions', 'legacy-session'), { recursive: true })
    writeFileSync(join(store, 'sessions', 'legacy-session', 'session.json'), '{"governed":true}\n')
    writeFileSync(join(store, 'hooks-manifest'), 'legacy global manifest\n')
    writeFileSync(join(store, 'plugin-folders'), '.legacy-global\n')
    writeFileSync(ledgers[0], '.former-host\n')
    const ledgerBundles = [
      writePlugin(proj, '.former-host', 'renamed-bundle', 'spexcode'),
      writePlugin(proj, '.legacy-global', 'spexcode', 'anything'),
    ]
    const standardBundle = writePlugin(proj, '.zcode', 'hand-dropped', 'spexcode')
    const folderStampedBundle = join(proj, row.home, 'plugins', 'spexcode')
    mkdirSync(folderStampedBundle, { recursive: true })
    writeFileSync(join(folderStampedBundle, 'legacy-product'), 'generated\n')
    const userPlugin = writePlugin(proj, '.zcode', 'user-plugin', 'user-plugin')

    // Codex-only init writes real trust. Claude-only gets a realistic stale Codex trust table from a prior policy.
    if (row.id === 'claude') {
      writeFileSync(codexConfig, `${userCodexConfig}\n# spexcode:trust:${proj} (managed — do not edit)\n[projects."${proj}"]\ntrust_level = "trusted"\n# spexcode:trust:end:${proj}\n`)
    }
    assert.ok(readFileSync(codexConfig, 'utf8').includes(`[projects."${proj}"]`), `${row.id}: current or stale Codex trust is present before uninstall`)

    const filterDir = join(proj, '.git', 'spexcode')
    writeFileSync(join(filterDir, 'user-evidence'), 'user-owned git-common data\n')
    assert.match(g('config', '--get', 'filter.spexcode.clean'), /contract-filter/, `${row.id}: content filter configured`)
    assert.match(readFileSync(excludePath, 'utf8'), /spexcode:start/, `${row.id}: managed exclude block present`)
    assert.match(readFileSync(attributesPath, 'utf8'), /spexcode:start/, `${row.id}: managed attributes block present`)

    const hooksDir = join(proj, '.git', 'hooks')
    const generatedHooks = readdirSync(HOOK_TEMPLATES).sort()
    const modifiedHook = 'prepare-commit-msg'
    writeFileSync(join(hooksDir, modifiedHook), Buffer.concat([
      readFileSync(join(hooksDir, modifiedHook)),
      Buffer.from('\n# user modification\n'),
    ]))
    const modifiedHookBytes = readFileSync(join(hooksDir, modifiedHook))
    const userHook = join(hooksDir, 'post-rewrite')
    writeFileSync(userHook, '#!/bin/sh\nprintf user-hook\\n\n')
    chmodSync(userHook, 0o755)

    // Default backout removes all derived wiring/state but deliberately leaves per-clone hooks.
    const first = spex('uninstall', '.')
    assert.match(first, /left git hooks in place/, `${row.id}: default hook policy is explicit`)
    for (const name of generatedHooks) assert.ok(existsSync(join(hooksDir, name)), `${row.id}: ${name} preserved without --hooks`)

    assert.deepEqual(snapshotTree(join(proj, '.spec')), specBefore, `${row.id}: tracked .spec/.plugins intent is byte-identical`)
    assert.ok(readFileSync(join(proj, 'spexcode.json')).equals(configBefore), `${row.id}: tracked spexcode.json intent is byte-identical`)
    for (const [path, content] of Object.entries(userFiles)) {
      assert.equal(readFileSync(join(proj, path), 'utf8'), content, `${row.id}: user ${path} bytes preserved`)
    }
    assert.ok(!existsSync(join(proj, row.shim)), `${row.id}: shim removed`)
    assert.ok(!existsSync(legacySkill) && !existsSync(staleSkill), `${row.id}: live-name legacy and stamped stale skills removed`)
    assert.equal(readFileSync(userSkill, 'utf8'), 'user skill: keep exactly\n', `${row.id}: foreign skill preserved`)
    assert.equal(readFileSync(userSettings, 'utf8'), '{"keep":true}\n', `${row.id}: foreign harness config preserved`)
    if (row.agent) {
      assert.ok(!existsSync(join(proj, row.agent)) && !existsSync(join(proj, row.home, 'agents', 'renamed-away.md')), 'claude: legacy and stamped agents removed')
      assert.equal(readFileSync(join(proj, row.home, 'agents', 'user-owned.md'), 'utf8'), 'user agent: keep exactly\n', 'claude: foreign agent preserved')
    }
    assert.ok(!existsSync(store), `${row.id}: whole current/legacy per-project runtime store removed`)
    for (const bundle of [...ledgerBundles, standardBundle, folderStampedBundle]) assert.ok(!existsSync(bundle), `${row.id}: owned plugin bundle removed: ${bundle}`)
    assert.ok(existsSync(userPlugin), `${row.id}: foreign plugin preserved`)
    assert.equal(readFileSync(codexConfig, 'utf8'), userCodexConfig, `${row.id}: only project trust removed from global Codex config`)
    assert.equal(readFileSync(excludePath, 'utf8'), 'user-local/\n', `${row.id}: only managed exclude block removed`)
    assert.equal(readFileSync(attributesPath, 'utf8'), '*.txt text\n', `${row.id}: only managed attributes block removed`)
    assert.throws(() => g('config', '--get-regexp', '^filter\\.spexcode\\.'), `${row.id}: filter config removed`)
    assert.ok(!existsSync(join(filterDir, 'contract-filter.sh')) && !existsSync(join(filterDir, 'contract-block.md')), `${row.id}: filter products removed`)
    assert.equal(readFileSync(join(filterDir, 'user-evidence'), 'utf8'), 'user-owned git-common data\n', `${row.id}: foreign git-common data preserved`)
    assert.doesNotMatch(g('ls-files', '-v', '--', row.contract), /^S /, `${row.id}: legacy skip-worktree bit cleared`)

    // The opt-in removes only canonical unchanged templates; user-modified and unrelated hooks survive.
    const withHooks = spex('uninstall', '.', '--hooks')
    assert.match(withHooks, /removed git hooks/, `${row.id}: --hooks reports the canonical removal set`)
    for (const name of generatedHooks.filter((name) => name !== modifiedHook)) {
      assert.ok(!existsSync(join(hooksDir, name)), `${row.id}: canonical ${name} removed`)
    }
    assert.ok(readFileSync(join(hooksDir, modifiedHook)).equals(modifiedHookBytes), `${row.id}: modified generated hook preserved`)
    assert.equal(readFileSync(userHook, 'utf8'), '#!/bin/sh\nprintf user-hook\\n\n', `${row.id}: unrelated user hook preserved`)

    const again = spex('uninstall', '.', '--hooks')
    assert.match(again, /no spexcode git hooks to remove/, `${row.id}: repeated hook backout is a clean no-op`)
    assert.doesNotMatch(again, /removed the global per-project store/, `${row.id}: absent store is not falsely reported removed`)
    assert.deepEqual(snapshotTree(join(proj, '.spec')), specBefore, `${row.id}: repeat keeps tracked intent`)
    assert.ok(statSync(join(proj, '.spec')).isDirectory(), `${row.id}: spec asset remains usable`)
  }
})
