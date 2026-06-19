#!/usr/bin/env node
// @@@ spex launcher - this repo has no build step, so the installed `spex` bin shells to tsx to
// run the TypeScript CLI directly. After `npm link` (or a global install) `spex lint` works anywhere.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// @@@ self-contained - resolve tsx + cli from THIS package, not the cwd. A fresh worktree off main has
// no node_modules, so `npx tsx` there would try to install; using the package's own tsx makes a global
// `spex` work from any cwd (agents, git hooks) against this package's code, operating on the cwd.
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsx = join(pkg, 'node_modules', '.bin', 'tsx')
const cli = join(pkg, 'src', 'cli.ts')
spawn(tsx, [cli, ...process.argv.slice(2)], { stdio: 'inherit' })
  .on('exit', (code) => process.exit(code ?? 0))
