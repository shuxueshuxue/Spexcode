#!/usr/bin/env node
// @@@ spex launcher ([[release-launcher]]) - package installs execute the package's compiled CLI directly;
// tsx remains a development tool and never enters an adopter's runtime closure.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Resolve from THIS package rather than cwd, so global and project-local installs run one compiled CLI.
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..') // spec-cli/
const cli = join(pkg, 'dist', 'cli.js')
const workspace = join(pkg, '..')

// @@@ mid-merge guard ([[merge-tooling-resilience]]) - a released package contains no source to scan;
// a source workspace does. Refuse to run its possibly stale dist while its imported source trees still
// carry unresolved conflict markers, so hooks keep the retryable exit-75 contract during a merge.
const sourceRoot = join(pkg, 'src')
if (existsSync(sourceRoot)) {
  const srcRoots = [sourceRoot, join(pkg, '..', 'packages', 'spec-core', 'src'), join(pkg, '..', 'packages', 'session-core', 'src'), join(pkg, '..', 'spec-eval', 'src'), join(pkg, '..', 'spec-forge', 'src')]
  const conflicted = srcRoots.flatMap((root) => {
    if (!existsSync(root)) return []
    return readdirSync(root, { recursive: true })
      .filter((f) => /\.(ts|tsx|js|mjs)$/.test(String(f)))
      .map((f) => join(root, String(f)))
      .filter((path) => {
        try { return /^<{7} /m.test(readFileSync(path, 'utf8')) } catch { return false }
      })
  })
  if (conflicted.length) {
    console.error('spex: paused mid-merge - unresolved conflict markers in the source SpexCode runs:')
    for (const file of conflicted) console.error(`  ${file}`)
    console.error('resolve the merge, rebuild SpexCode, then retry. (exit 75)')
    process.exit(75)
  }

  // @@@ source-workspace build ([[release-launcher]]) - the git hooks invoke this launcher straight from a
  // checkout, where dist is intentionally untracked. Rebuild the complete runtime closure before linting
  // candidate source; an installed package has no src tree and stays a pure Node -> dist execution path.
  const runtimeEntries = [
    cli,
    join(workspace, 'packages', 'spec-core', 'dist', 'index.js'),
    join(workspace, 'packages', 'session-core', 'dist', 'index.js'),
    join(workspace, 'spec-eval', 'dist', 'index.js'),
    join(workspace, 'spec-forge', 'dist', 'index.js'),
  ]
  const newestSource = srcRoots.reduce((newest, root) => {
    if (!existsSync(root)) return newest
    for (const entry of readdirSync(root, { recursive: true })) {
      const path = join(root, String(entry))
      try {
        if (/\.(ts|tsx|js|mjs)$/.test(path)) newest = Math.max(newest, statSync(path).mtimeMs)
      } catch { /* a concurrent source edit can only make the next invocation rebuild again */ }
    }
    return newest
  }, 0)
  const rebuild = runtimeEntries.some((entry) => {
    try { return statSync(entry).mtimeMs < newestSource } catch { return true }
  })
  if (rebuild) {
    const build = spawnSync('npm', ['run', 'build'], { cwd: workspace, stdio: 'inherit' })
    if (build.error || build.status !== 0 || !existsSync(cli)) {
      console.error('spex: source workspace build failed; fix it, then retry.')
      process.exit(build.status ?? 1)
    }
  }
}
const args = process.argv.slice(2)
const env = { ...process.env }
// A backend/dashboard is a project or host control plane, never the managed session that happened to start it.
if (args[0] === 'serve' || args[0] === 'dashboard') {
  const identityKeys = (env.SPEXCODE_SESSION_IDENTITY_VARS
    || 'SPEXCODE_SESSION_ID,CLAUDE_CODE_SESSION_ID,CODEX_THREAD_ID,OPENCODE_SESSION_ID,PI_SESSION_ID')
    .split(',').map((key) => key.trim()).filter(Boolean)
  for (const key of identityKeys) delete env[key]
}
spawn(process.execPath, [cli, ...args], { stdio: 'inherit', env })
  .on('exit', (code) => process.exit(code ?? 0))
