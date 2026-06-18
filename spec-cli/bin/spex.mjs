#!/usr/bin/env node
// @@@ spex launcher - this repo has no build step, so the installed `spex` bin shells to tsx to
// run the TypeScript CLI directly. After `npm link` (or a global install) `spex lint` works anywhere.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts')
spawn('npx', ['tsx', cli, ...process.argv.slice(2)], { stdio: 'inherit' })
  .on('exit', (code) => process.exit(code ?? 0))
