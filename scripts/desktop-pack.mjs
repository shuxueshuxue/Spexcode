import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RELEASE_PACKAGES } from './release-publish.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const repo = dirname(root)
const evidence = resolve(process.env.SPEXCODE_EVIDENCE_DIR || '/home/jeffry/spex-evidence/desktop-packaging')
const output = resolve(process.env.SPEXCODE_DESKTOP_OUTPUT_DIR || join(evidence, 'artifacts'))
const work = join(evidence, '.work')
const bundle = join(work, 'bundle')
const tarballs = join(bundle, 'tarballs')

function fail(message) {
  throw new Error(`desktop-pack: ${message}`)
}

function run(command, args, options = {}) {
  const executable = process.platform === 'win32' && (command === 'npm' || command.endsWith('electron-builder')) ? `${command}.cmd` : command
  const result = spawnSync(executable, args, {
    cwd: options.cwd || repo,
    env: options.env,
    encoding: 'utf8',
    stdio: options.stdio || 'inherit',
    shell: executable.endsWith('.cmd'),
  })
  if (result.error) fail(`${command} failed to start: ${result.error.message}`)
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed (${result.status})`)
  return result
}

function gitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' })
  if (result.status !== 0) fail(`cannot read git HEAD: ${(result.stderr || '').trim()}`)
  return result.stdout.trim()
}

function manifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function pack(entry, destination) {
  const result = run('npm', ['pack', '--silent', '--ignore-scripts', '--json', '--pack-destination', destination], {
    cwd: join(repo, entry.dir),
    stdio: 'pipe',
  })
  let rows
  try { rows = JSON.parse(result.stdout) } catch { fail(`${entry.name} npm pack did not return JSON`) }
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].name !== entry.name) fail(`${entry.name} pack identity is wrong`)
  return join(destination, rows[0].filename)
}

function extract(tarball, destination) {
  mkdirSync(destination, { recursive: true })
  const tarPath = process.platform === 'win32'
    ? (value) => {
      const result = spawnSync('cygpath', ['-u', value], { encoding: 'utf8' })
      if (result.status !== 0) fail(`cygpath failed for ${value}`)
      return result.stdout.trim()
    }
    : (value) => value
  run('tar', ['-xzf', tarPath(tarball), '-C', tarPath(destination), '--strip-components=1'])
}

function stampPackage(path, commit) {
  const value = manifest(path)
  value.spexcodeCommit = commit
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  return value
}

function packageFiles(rootDir) {
  const found = []
  const visit = (dir) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.name === 'package.json') {
        try {
          const value = manifest(path)
          if (typeof value.name === 'string' && value.name.startsWith('@spexcode/')) found.push({ path, value })
        } catch { /* unrelated package metadata is not part of the closure */ }
      }
    }
  }
  visit(join(rootDir, 'node_modules'))
  return found
}

function installExternalDependencies(packageManifests) {
  const internal = new Set(RELEASE_PACKAGES.map((entry) => entry.name))
  const dependencies = {}
  const optionalDependencies = {}
  for (const value of packageManifests) {
    for (const [name, range] of Object.entries(value.dependencies || {})) if (!internal.has(name)) dependencies[name] = range
    for (const [name, range] of Object.entries(value.optionalDependencies || {})) if (!internal.has(name)) optionalDependencies[name] = range
  }
  const rootManifestPath = join(bundle, 'package.json')
  const original = manifest(rootManifestPath)
  const installManifest = { name: 'spexcode-desktop-runtime', version: original.version, private: true, type: 'module', dependencies, optionalDependencies }
  writeFileSync(rootManifestPath, `${JSON.stringify(installManifest, null, 2)}\n`)
  run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund'], { cwd: bundle })
  original.spexcodeCommit = original.spexcodeCommit
  writeFileSync(rootManifestPath, `${JSON.stringify(original, null, 2)}\n`)
}

async function main() {
  const started = Date.now()
  const commit = gitHead()
  const rootVersion = manifest(join(repo, 'package.json')).version
  const desktopVersion = manifest(join(repo, 'spec-desktop', 'package.json')).version
  if (desktopVersion !== rootVersion) fail(`desktop package version ${desktopVersion} does not match root ${rootVersion}`)
  rmSync(work, { recursive: true, force: true })
  rmSync(output, { recursive: true, force: true })
  mkdirSync(tarballs, { recursive: true })
  mkdirSync(output, { recursive: true })

  run('npm', ['run', 'build'])
  run('npm', ['run', 'prepack'], { cwd: join(repo, 'spec-dashboard') })

  const packed = []
  for (const entry of RELEASE_PACKAGES) packed.push({ entry, path: pack(entry, tarballs) })
  const rootTarball = packed.find(({ entry }) => entry.id === 'root')?.path
  if (!rootTarball) fail('root tarball was not produced')
  extract(rootTarball, bundle)
  stampPackage(join(bundle, 'package.json'), commit)

  const packageManifests = []
  for (const { entry, path } of packed.filter(({ entry }) => entry.id !== 'root')) {
    const target = join(bundle, 'node_modules', entry.name)
    extract(path, target)
    packageManifests.push(stampPackage(join(target, 'package.json'), commit))
  }
  // The CLI tarball may contain bundled internal copies. Stamp and validate every copy so the bundle never
  // silently carries a second release line.
  for (const { path, value } of packageFiles(bundle)) {
    stampPackage(path, commit)
    packageManifests.push(value)
  }
  installExternalDependencies([manifest(join(bundle, 'package.json')), ...packageManifests])
  // npm prune removes packages that are not in the temporary external-only manifest. Re-extract the
  // monorepo tarballs after that install so every internal package remains a direct, stamped runtime.
  for (const { entry, path } of packed.filter(({ entry }) => entry.id !== 'root')) {
    const target = join(bundle, 'node_modules', entry.name)
    rmSync(target, { recursive: true, force: true })
    extract(path, target)
    stampPackage(join(target, 'package.json'), commit)
  }

  const expected = RELEASE_PACKAGES.filter(({ id }) => id !== 'root').map(({ name, dir }) => ({ name, dir }))
  const packageRows = packageFiles(bundle)
  const versions = new Set(packageRows.map(({ value }) => value.version))
  const commits = new Set(packageRows.map(({ value }) => value.spexcodeCommit))
  if (versions.size !== 1 || !versions.has(rootVersion) || commits.size !== 1 || !commits.has(commit)) {
    fail(`bundled @spexcode manifests do not share root version ${rootVersion} and commit ${commit}`)
  }
  if (!expected.every(({ name }) => packageRows.some(({ value }) => value.name === name))) fail('one or more @spexcode workspaces are missing from the bundle')
  writeFileSync(join(bundle, 'commit.json'), `${JSON.stringify({ commit, version: rootVersion, packages: expected.map(({ name }) => name) }, null, 2)}\n`)

  const builder = resolve(repo, 'spec-desktop', 'node_modules', '.bin', 'electron-builder')
  if (!existsSync(builder)) fail('electron-builder is not installed; run npm run desktop:install first')
  const env = { ...process.env, SPEXCODE_DESKTOP_BUNDLE_DIR: bundle, SPEXCODE_DESKTOP_OUTPUT_DIR: output }
  run(builder, ['--config', resolve(repo, 'spec-desktop', 'electron-builder.config.cjs'), '--linux', 'AppImage', 'deb', '--publish', 'never'], { env })

  const artifacts = readdirSync(output).filter((name) => /\.(AppImage|deb)$/.test(name)).map((name) => ({ name, bytes: statSync(join(output, name)).size }))
  if (artifacts.length < 2) fail(`expected AppImage and deb artifacts in ${output}`)
  const elapsedMs = Date.now() - started
  writeFileSync(join(evidence, 'README.md'), [
    '# SpexCode desktop packaging',
    '',
    `Machine: ${process.platform} ${process.arch}`,
    `Commit: ${commit}`,
    `Method: npm run desktop:pack (electron-builder; unsigned, no notarization, no auto-update)`,
    `Build time: ${(elapsedMs / 1000).toFixed(1)}s`,
    '',
    'Artifacts:',
    ...artifacts.map(({ name, bytes }) => `- ${name}: ${(bytes / 1024 / 1024).toFixed(1)} MiB (${bytes} bytes)`),
    '',
  ].join('\n'))
  console.log(`[desktop-pack] ${commit} in ${(elapsedMs / 1000).toFixed(1)}s`)
  for (const artifact of artifacts) console.log(`[desktop-pack] ${artifact.name} ${artifact.bytes} bytes`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
