#!/usr/bin/env node
// @@@ spex launcher - this repo has no build step, so the installed `spex` bin shells to tsx to
// run the TypeScript CLI directly. After `npm link` (or a global install) `spex lint` works anywhere.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// @@@ self-contained - resolve tsx + cli from THIS package, not the cwd. A fresh worktree off main has
// no node_modules, so `npx tsx` there would try to install; using the package's own tsx makes a global
// `spex` work from any cwd (agents, git hooks) against this package's code, operating on the cwd.
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..') // spec-cli/
const cli = join(pkg, 'src', 'cli.ts')
// tsx lives in spec-cli/node_modules in the dev monorepo, but at the PUBLISHED package root's
// node_modules (one level up: spec-cli is a subdir of the `spexcode` tarball) when installed. Try both.
const tsxCandidates = [join(pkg, 'node_modules', '.bin', 'tsx'), join(pkg, '..', 'node_modules', '.bin', 'tsx')]
const tsx = tsxCandidates.find(existsSync) ?? tsxCandidates[0]
spawn(tsx, [cli, ...process.argv.slice(2)], { stdio: 'inherit' })
  .on('exit', (code) => process.exit(code ?? 0))
