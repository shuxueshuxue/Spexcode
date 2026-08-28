import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

export const RELEASE_PACKAGES = Object.freeze([
  { id: 'transcript', dir: 'packages/transcript', name: '@spexcode/transcript', build: [['run', 'build']] },
  { id: 'transcript-ui', dir: 'packages/transcript-ui', name: '@spexcode/transcript-ui', build: [['run', 'build']] },
  { id: 'terminal-ui', dir: 'packages/terminal-ui', name: '@spexcode/terminal-ui', build: [['run', 'build']] },
  { id: 'session-protocol', dir: 'packages/session-protocol', name: '@spexcode/session-protocol', build: [['run', 'build']] },
  { id: 'session-topology', dir: 'packages/session-topology', name: '@spexcode/session-topology', build: [['run', 'build']] },
  { id: 'session-runtime', dir: 'packages/session-runtime', name: '@spexcode/session-runtime', build: [['run', 'build']] },
  { id: 'session-events', dir: 'packages/session-events', name: '@spexcode/session-events', build: [['run', 'build']] },
  { id: 'session-application', dir: 'packages/session-application', name: '@spexcode/session-application', build: [['run', 'build']] },
  { id: 'session-selflaunch', dir: 'packages/session-selflaunch', name: '@spexcode/session-selflaunch', build: [['run', 'build']] },
  { id: 'core', dir: 'packages/spec-core', name: '@spexcode/spec-core', build: [['run', 'build']] },
  { id: 'dashboard', dir: 'spec-dashboard', name: '@spexcode/spec-dashboard', build: [['run', 'prepack']] },
  { id: 'eval', dir: 'spec-eval', name: '@spexcode/spec-eval', build: [['run', 'build']] },
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

function published(name, version) {
  const result = npm(['view', `${name}@${version}`, 'version', '--json'], { stdio: 'pipe' })
  if (result.status === 0) return true
  const output = `${result.stdout}\n${result.stderr}`
  if (/\bE404\b|\b404\b/.test(output)) return false
  fail(`registry lookup for ${name}@${version} failed: ${output.trim()}`)
}

function publish(plan) {
  const state = registryState(plan.entries, published)
  requireAbsentRegistry(state, plan.version)
  const tag = distTagFor(plan.version)
  for (const entry of plan.entries) {
    console.log(`[release] publishing ${entry.name}@${plan.version} (dist-tag ${tag})`)
    const result = npm(['publish', '--access', 'public', '--tag', tag], {
      cwd: dirname(entry.path),
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
  console.log(`[release] ${mode === 'publish' ? 'publishing' : 'checked'} ${plan.version}: ${plan.entries.map((entry) => entry.id).join(' -> ')}`)
  if (mode === 'publish') publish(plan)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
