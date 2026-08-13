#!/usr/bin/env node
// @@@ spex launcher ([[release-launcher]]) - package installs execute the package's compiled CLI directly;
// tsx remains a development tool and never enters an adopter's runtime closure.
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Resolve from THIS package rather than cwd, so global and project-local installs run one compiled CLI.
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..') // spec-cli/
const cli = join(pkg, 'dist', 'cli.js')

// @@@ mid-merge guard ([[merge-tooling-resilience]]) - a released package contains no source to scan;
// a source workspace does. Refuse to run its possibly stale dist while its imported source trees still
// carry unresolved conflict markers, so hooks keep the retryable exit-75 contract during a merge.
const sourceRoot = join(pkg, 'src')
if (existsSync(sourceRoot)) {
  const srcRoots = [sourceRoot, join(pkg, '..', 'spec-eval', 'src'), join(pkg, '..', 'spec-forge', 'src')]
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
