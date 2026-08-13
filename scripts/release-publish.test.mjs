import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { RELEASE_PACKAGES, assertReleaseCheckout, registryState, releasePlan, requireAbsentRegistry } from './release-publish.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'spex-release-publish-'))
  for (const entry of RELEASE_PACKAGES) {
    const source = join(root, entry.dir, 'package.json')
    const destination = join(dir, entry.dir, 'package.json')
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(source, destination, { force: true })
  }
  return dir
}

function changeManifest(base, entry, change) {
  const path = join(base, entry.dir, 'package.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  change(manifest)
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

test('release producer keeps one complete ordered package set', () => {
  const plan = releasePlan()
  assert.equal(plan.version, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version)
  assert.deepEqual(plan.entries.map((entry) => entry.id), ['core', 'eval', 'forge', 'cli', 'dashboard', 'root'])
  assert.equal(registryState(plan.entries, () => false), 'absent')
  assert.equal(registryState(plan.entries, () => true), 'complete')
  assert.equal(registryState(plan.entries, (name) => name === '@spexcode/spec-core'), 'partial (@spexcode/spec-core)')
  assert.throws(
    () => requireAbsentRegistry('partial (@spexcode/spec-core)', plan.version),
    /refusing a partial or duplicate release/,
  )
})

test('release producer rejects a stale internal release reference before npm runs', () => {
  const dir = fixture()
  try {
    changeManifest(dir, RELEASE_PACKAGES.find((entry) => entry.id === 'cli'), (manifest) => {
      manifest.dependencies['@spexcode/spec-eval'] = '0.0.0'
    })
    assert.throws(() => releasePlan(dir), /references @spexcode\/spec-eval@0\.0\.0/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('release producer rejects a package version that drifts from the release set', () => {
  const dir = fixture()
  try {
    changeManifest(dir, RELEASE_PACKAGES.find((entry) => entry.id === 'dashboard'), (manifest) => { manifest.version = '0.0.0' })
    assert.throws(() => releasePlan(dir), /all public packages must share one release version/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('release producer rejects an invalid shared release version', () => {
  const dir = fixture()
  try {
    for (const entry of RELEASE_PACKAGES) {
      changeManifest(dir, entry, (manifest) => { manifest.version = 'next' })
    }
    assert.throws(() => releasePlan(dir), /must be an exact semver version/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('release producer rejects a package without the direct-publish guard', () => {
  const dir = fixture()
  try {
    changeManifest(dir, RELEASE_PACKAGES.find((entry) => entry.id === 'forge'), (manifest) => {
      delete manifest.scripts.prepublishOnly
    })
    assert.throws(() => releasePlan(dir), /must guard direct npm publish/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('direct package publish guard points at the only release command', () => {
  const result = spawnSync('npm', ['publish', '--dry-run'], {
    cwd: join(root, 'packages', 'spec-core'),
    encoding: 'utf8',
  })
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}\n${result.stderr}`, /direct npm publish is disabled; run npm run release:publish/)
})

test('release publish rejects a non-main or dirty checkout before it builds or contacts the registry', () => {
  assert.throws(
    () => assertReleaseCheckout({ branch: 'node/release-publish', clean: true }),
    /release must run from the checked-out main branch/,
  )
  assert.throws(
    () => assertReleaseCheckout({ branch: 'main', clean: false }),
    /refusing to release a dirty checkout/,
  )
})
