#!/usr/bin/env node
// @@@ spex launcher - this repo has no build step, so the installed `spex` bin shells to tsx to
// run the TypeScript CLI directly. After `npm link` (or a global install) `spex lint` works anywhere.
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// @@@ self-contained - resolve tsx + cli from THIS package, not the cwd. A fresh worktree off main has
// no node_modules, so `npx tsx` there would try to install; using the package's own tsx makes a global
// `spex` work from any cwd (agents, git hooks) against this package's code, operating on the cwd.
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..') // spec-cli/
const cli = join(pkg, 'src', 'cli.ts')

// @@@ mid-merge guard - no build step means every spex call parses this package's live TypeScript, so
// while a merge conflict is being resolved in the checkout that hosts it, the source holds conflict
// markers and tsx dies with a raw esbuild stacktrace — on EVERY call, including the Stop hook and an
// agent's `spex session done`. Catch that one transient state up front: scan the source trees the CLI
// imports (spec-cli ←→ spec-yatsu ←→ spec-forge), and if any file carries a marker, print one actionable
// line and exit 75 (EX_TEMPFAIL: transient, retry) instead of spawning tsx into the stacktrace.
const srcRoots = [join(pkg, 'src'), join(pkg, '..', 'spec-yatsu', 'src'), join(pkg, '..', 'spec-forge', 'src')]
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
  console.error('spex: paused mid-merge — unresolved conflict markers in the source spex runs:')
  for (const f of conflicted) console.error(`  ${f}`)
  console.error('spex executes this TypeScript directly (no build step); resolve the merge, then retry. (exit 75)')
  process.exit(75)
}
// @@@ cross-platform tsx resolution ([[platform-support]]) - resolve tsx's JS ENTRY (dist/cli.mjs) with
// Node's own resolver from spec-cli, then run it through THIS node binary (process.execPath). tsx may live
// in spec-cli/node_modules (dev) or be hoisted above the installed `spexcode` package (a real consumer
// project) — one resolver covers both without hardcoded consumer paths. We deliberately never spawn the
// `.bin/tsx` shim, nor a `.mjs` directly: on Windows the shim is an extensionless sh script and the `.mjs`
// leans on a shebang, neither of which `child_process.spawn` can execute — that is the #37 crash
// (`spawn …\node_modules\.bin\tsx ENOENT`) of `spex init`. `node dist/cli.mjs …` is shell-free and identical
// on every OS.
function resolveTsxCli() {
  try {
    const req = createRequire(join(pkg, 'package.json'))
    return join(dirname(req.resolve('tsx/package.json')), 'dist', 'cli.mjs')
  } catch {
    console.error('spex: cannot find the `tsx` runtime this package needs — run `npm install` in the SpexCode package, then retry.')
    process.exit(69)
  }
}
const tsxCli = resolveTsxCli()
spawn(process.execPath, [tsxCli, cli, ...process.argv.slice(2)], { stdio: 'inherit' })
  .on('exit', (code) => process.exit(code ?? 0))
