import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

export const RELEASE_PACKAGES = Object.freeze([
  { id: 'archify', dir: 'packages/archify', name: '@spexcode/archify', build: [['run', 'build']] },
  { id: 'transcript', dir: 'packages/transcript', name: '@spexcode/transcript', build: [['run', 'build']] },
  { id: 'transcript-ui', dir: 'packages/transcript-ui', name: '@spexcode/transcript-ui', build: [['run', 'build']] },
  { id: 'session-protocol', dir: 'packages/session-protocol', name: '@spexcode/session-protocol', build: [['run', 'build']] },
  { id: 'session-topology', dir: 'packages/session-topology', name: '@spexcode/session-topology', build: [['run', 'build']] },
  { id: 'session-runtime', dir: 'packages/session-runtime', name: '@spexcode/session-runtime', build: [['run', 'build']] },
  { id: 'session-events', dir: 'packages/session-events', name: '@spexcode/session-events', build: [['run', 'build']] },
  { id: 'session-application', dir: 'packages/session-application', name: '@spexcode/session-application', build: [['run', 'build']] },
  { id: 'core', dir: 'packages/spec-core', name: '@spexcode/spec-core', build: [['run', 'build']] },
  { id: 'dashboard', dir: 'spec-dashboard', name: '@spexcode/spec-dashboard', build: [['run', 'prepack']] },
  { id: 'forge', dir: 'spec-forge', name: '@spexcode/spec-forge', build: [['run', 'build']] },
  { id: 'cli', dir: 'spec-cli', name: '@spexcode/spec-cli', build: [['run', 'build']] },
  { id: 'root', dir: '.', name: 'spexcode', build: [['run', 'prepack']] },
])

const packageNames = new Set(RELEASE_PACKAGES.map((entry) => entry.name))

function fail(message) {
  throw new Error(`release-publish: ${message}`)
}

function npm(args, { cwd = root, env, stdio = 'inherit' } = {}) {
  const result = spawnSync('npm', args, { cwd, env, encoding: 'utf8', stdio })
  if (result.error) fail(`npm ${args.join(' ')} failed to start: ${result.error.message}`)
  return result
}

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) fail(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`)
  return result.stdout.trim()
}

function manifestFor(entry, base = root) {
  const path = join(base, entry.dir, 'package.json')
  if (!existsSync(path)) fail(`${entry.id} manifest is missing at ${path}`)
  return { ...entry, path, manifest: JSON.parse(readFileSync(path, 'utf8')) }
}

function allManifestDependencies(manifest) {
  return {
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
  }
}

export function releasePlan(base = root) {
  const entries = RELEASE_PACKAGES.map((entry) => manifestFor(entry, base))
  const versions = new Set(entries.map((entry) => entry.manifest.version))
  if (versions.size !== 1) {
    const found = entries.map((entry) => `${entry.name}@${entry.manifest.version}`).join(', ')
    fail(`all public packages must share one release version; found ${found}`)
  }
  const [version] = versions
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`release version ${version} must be an exact semver version`)
  }

  for (const entry of entries) {
    if (entry.manifest.name !== entry.name) fail(`${entry.id} manifest names ${entry.manifest.name}, expected ${entry.name}`)
    if (entry.manifest.publishConfig?.access !== 'public') fail(`${entry.name} must declare publishConfig.access public`)
    if (!entry.manifest.scripts?.prepublishOnly?.includes('release-publish.mjs --from-package-publish')) {
      fail(`${entry.name} must guard direct npm publish with release-publish.mjs`)
    }
    const dependencies = allManifestDependencies(entry.manifest)
    for (const [name, range] of Object.entries(dependencies)) {
      if (packageNames.has(name) && range !== version) {
        fail(`${entry.name} references ${name}@${range}; every internal release reference must be ${version}`)
      }
    }
  }
  return { version, entries }
}

// A prerelease version (`0.7.0-next.0`) is published under the `next` dist-tag so `npm i spexcode` keeps
// resolving the last stable release; a stable version moves `latest`. The tag is derived from the version,
// never chosen by hand, so one committed version means one registry state.
export function distTagFor(version) {
  return /-/.test(version) ? 'next' : 'latest'
}

export function registryState(entries, lookup) {
  const present = entries.filter((entry) => lookup(entry.name, entry.manifest.version))
  if (present.length === 0) return 'absent'
  if (present.length === entries.length) return 'complete'
  return `partial (${present.map((entry) => entry.name).join(', ')})`
}

export function requireAbsentRegistry(state, version) {
  if (state !== 'absent') {
    fail(`registry already contains ${version}: ${state}; refusing a partial or duplicate release`)
  }
}

export function assertReleaseCheckout({ branch, clean }) {
  if (branch !== 'main') fail('release must run from the checked-out main branch')
  if (!clean) fail('refusing to release a dirty checkout')
}

function assertMainAndClean() {
  assertReleaseCheckout({
    branch: git(['branch', '--show-current']),
    clean: !git(['status', '--porcelain=v1', '--untracked-files=all']),
  })
}

// The whole workspace closure is compiled once, in dependency order, before any tarball is built: a package
// that imports a sibling's compiled entry at BUILD time (the dashboard bundles `@spexcode/spec-cli/ranker`)
// resolves it in a fresh clone, where no dist exists yet and the publication order puts that sibling later.
function buildClosure() {
  const result = npm(['run', 'build'])
  if (result.status !== 0) fail('workspace build failed')
}

function preflight(plan) {
  buildClosure()
  for (const entry of plan.entries) {
    for (const args of entry.build) {
      const result = npm(args, { cwd: dirname(entry.path) })
      if (result.status !== 0) fail(`${entry.name} build failed`)
    }
    const result = npm(['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: dirname(entry.path), stdio: 'pipe' })
    if (result.status !== 0) fail(`${entry.name} tarball preflight failed: ${(result.stderr || result.stdout).trim()}`)
    try {
      const rows = JSON.parse(result.stdout)
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].name !== entry.name || rows[0].version !== plan.version) {
        fail(`${entry.name} tarball preflight returned the wrong package identity`)
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('release-publish:')) throw error
      fail(`${entry.name} tarball preflight did not return npm JSON`)
    }
  }
}

// @@@ root bundle - npm packs a bundled dependency only when it is a real directory, and in the workspace every
// @spexcode package is a symlink, so a root packed in place ships a metapackage with an empty bundle (0.7.0-next.17
// went out that way: four files, no CLI). The root is therefore packed from a staging copy whose node_modules holds
// real installs of the CLI's release-internal closure, installed from the tarballs of this very release — no
// registry round-trip for a sibling published seconds earlier. The rehearsal stages it too and refuses a root whose
// tarball does not carry the CLI, so the check catches what the in-place pack silently dropped.
export function bundleClosure(entries, rootName = 'spexcode') {
  const byName = new Map(entries.map((entry) => [entry.name, entry]))
  const root = byName.get(rootName)
  const bundled = root?.manifest.bundleDependencies ?? root?.manifest.bundledDependencies ?? []
  const closure = new Set()
  const visit = (name) => {
    if (closure.has(name) || !byName.has(name)) return
    closure.add(name)
    for (const dep of Object.keys(byName.get(name).manifest.dependencies ?? {})) visit(dep)
  }
  for (const name of bundled) visit(name)
  return entries.filter((entry) => closure.has(entry.name))
}

export function stageRoot(plan) {
  const rootEntry = plan.entries.find((entry) => entry.id === 'root')
  const closure = bundleClosure(plan.entries)
  if (!closure.length) fail('the root bundles no release package; nothing to stage')
  const tarballs = mkdtempSync(join(tmpdir(), 'spexcode-release-tarballs-'))
  const stage = mkdtempSync(join(tmpdir(), 'spexcode-release-root-'))
  const files = []
  for (const entry of closure) {
    const result = npm(['pack', '--ignore-scripts', '--json', '--pack-destination', tarballs], { cwd: dirname(entry.path), stdio: 'pipe' })
    if (result.status !== 0) fail(`${entry.name} pack for the root bundle failed: ${(result.stderr || result.stdout).trim()}`)
    files.push(join(tarballs, JSON.parse(result.stdout)[0].filename))
  }
  const { scripts: _scripts, devDependencies: _dev, ...manifest } = rootEntry.manifest
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  for (const path of [...(manifest.files ?? []), 'README.md', 'LICENSE']) {
    if (existsSync(join(root, path))) cpSync(join(root, path), join(stage, path), { recursive: true })
  }
  const install = npm(['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--no-save', ...files], { cwd: stage, stdio: 'pipe' })
  if (install.status !== 0) fail(`installing the root bundle failed: ${(install.stderr || install.stdout).trim()}`)
  const packed = npm(['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: stage, stdio: 'pipe' })
  if (packed.status !== 0) fail(`root tarball preflight failed: ${(packed.stderr || packed.stdout).trim()}`)
  const [row] = JSON.parse(packed.stdout)
  const missing = closure.filter((entry) => !row.files.some((file) => file.path === `node_modules/${entry.name}/package.json`))
  if (row.name !== rootEntry.name || row.version !== plan.version || missing.length) {
    fail(`the root tarball does not carry its bundle${missing.length ? ` (missing ${missing.map((entry) => entry.name).join(', ')})` : ''}`)
  }
  rmSync(tarballs, { recursive: true, force: true })
  console.log(`[release] root bundle staged: ${row.files.length} files, ${closure.map((entry) => entry.id).join(', ')}`)
  return stage
}

function published(name, version) {
  const result = npm(['view', `${name}@${version}`, 'version', '--json'], { stdio: 'pipe' })
  if (result.status === 0) return true
  const output = `${result.stdout}\n${result.stderr}`
  if (/\bE404\b|\b404\b/.test(output)) return false
  fail(`registry lookup for ${name}@${version} failed: ${output.trim()}`)
}

function publish(plan, rootStage) {
  const state = registryState(plan.entries, published)
  requireAbsentRegistry(state, plan.version)
  const tag = distTagFor(plan.version)
  for (const entry of plan.entries) {
    console.log(`[release] publishing ${entry.name}@${plan.version} (dist-tag ${tag})`)
    // The root publishes from its staged copy (already built, its bundle installed); every other package from its
    // own directory, through its guarded publish scripts.
    const staged = entry.id === 'root'
    const result = npm(['publish', '--access', 'public', '--tag', tag, ...(staged ? ['--ignore-scripts'] : [])], {
      cwd: staged ? rootStage : dirname(entry.path),
      env: { ...process.env, SPEX_RELEASE_PUBLISH: plan.version },
    })
    if (result.status !== 0) fail(`${entry.name}@${plan.version} publish failed; registry state is now partial and requires human review`)
  }
}

function packagePublishGuard() {
  const current = relative(root, process.cwd()) || '.'
  const entry = RELEASE_PACKAGES.find((candidate) => candidate.dir === current)
  if (!entry || process.env.SPEX_RELEASE_PUBLISH !== releasePlan().version) {
    fail('direct npm publish is disabled; run npm run release:publish from the repository root')
  }
}

function parseArgs(argv) {
  if (argv.length === 0) return 'check'
  if (argv.length === 1 && argv[0] === '--publish') return 'publish'
  if (argv.length === 1 && argv[0] === '--from-package-publish') return 'guard'
  fail('usage: node scripts/release-publish.mjs [--publish]')
}

function main() {
  const mode = parseArgs(process.argv.slice(2))
  if (mode === 'guard') return packagePublishGuard()
  const plan = releasePlan()
  if (mode === 'publish') assertMainAndClean()
  preflight(plan)
  const rootStage = stageRoot(plan)
  console.log(`[release] ${mode === 'publish' ? 'publishing' : 'checked'} ${plan.version}: ${plan.entries.map((entry) => entry.id).join(' -> ')}`)
  if (mode === 'publish') publish(plan, rootStage)
  rmSync(rootStage, { recursive: true, force: true })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
