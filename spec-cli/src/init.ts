import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, chmodSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

// this file lives at <pkgRoot>/src/init.ts, so `..` is the package root — the same derivation the
// launch paths use, never a hardcoded repo path (so a relocated/installed package still finds its data).
const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const TEMPLATES = join(pkgRoot, 'templates')

// recursively copy srcDir -> destDir, NEVER overwriting an existing file. Returns the repo-relative
// paths of files actually written (so the caller can report exactly what was planted vs already there).
function copyTreeNoClobber(srcDir: string, destDir: string, base: string): string[] {
  const written: string[] = []
  mkdirSync(destDir, { recursive: true })
  for (const e of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, e.name)
    const dest = join(destDir, e.name)
    if (e.isDirectory()) {
      written.push(...copyTreeNoClobber(src, dest, base))
    } else if (existsSync(dest)) {
      // additive only — a pre-existing file is the user's, leave it untouched.
      continue
    } else {
      copyFileSync(src, dest)
      written.push(relative(base, dest))
    }
  }
  return written
}

// resolve the target repo's git hooks dir the same way scripts/install-hooks.sh does — the COMMON dir's
// hooks/ (shared across all worktrees). Returns null (with a loud reason) when <dir> isn't a git repo.
function resolveHooksDir(dir: string): string | null {
  try {
    const common = execFileSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'], // swallow git's own "fatal: not a git repository" — our warning is the signal
    }).trim()
    return join(common, 'hooks')
  } catch {
    return null
  }
}

export async function specInit(targetArg: string | undefined): Promise<void> {
  const targetDir = resolve(targetArg ?? process.cwd())
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
  console.log(`spex init → ${targetDir}`)

  // 1. seed the spec tree: templates/spec/* -> <dir>/.spec/* (an existing .spec aborts this phase loudly).
  const specDest = join(targetDir, '.spec')
  if (existsSync(specDest)) {
    console.warn(`• .spec already exists at ${specDest} — skipping spec scaffold (won't overwrite an existing tree).`)
  } else {
    const planted = copyTreeNoClobber(join(TEMPLATES, 'spec'), specDest, targetDir)
    console.log(`✓ seeded ${planted.length} spec file(s) under .spec/ (root 'project' node + default .config)`)
  }

  // 1b. plant a starter spexcode.json (the lint/layout knob), pointing governedRoots at `src/`.
  const cfgDest = join(targetDir, 'spexcode.json')
  if (existsSync(cfgDest)) {
    console.warn(`• spexcode.json already exists at ${cfgDest} — left untouched.`)
  } else {
    copyFileSync(join(TEMPLATES, 'spexcode.json'), cfgDest)
    console.log(`✓ planted spexcode.json — set lint.governedRoots to YOUR source dirs (starter: ["src"])`)
  }

  // 2. install the git hooks: templates/hooks/* -> <repo>/<common-git-dir>/hooks/* (skip any that exist).
  const hooksDir = resolveHooksDir(targetDir)
  if (!hooksDir) {
    console.warn(`• ${targetDir} is not a git repository — skipped hook install. Run \`git init\` there, then \`spex init\` again (or \`npm run hooks\`).`)
  } else {
    mkdirSync(hooksDir, { recursive: true })
    const hooksSrc = join(TEMPLATES, 'hooks')
    const installed: string[] = []
    for (const e of readdirSync(hooksSrc, { withFileTypes: true })) {
      if (!e.isFile()) continue
      const dest = join(hooksDir, e.name)
      if (existsSync(dest)) {
        console.warn(`• hook ${e.name} already exists in ${hooksDir} — left untouched.`)
        continue
      }
      copyFileSync(join(hooksSrc, e.name), dest)
      chmodSync(dest, 0o755)
      installed.push(e.name)
    }
    if (installed.length) console.log(`✓ installed git hooks (${installed.join(', ')}) → ${hooksDir}`)
  }

  // 3. next steps — what the human must do to bring the instance to life.
  console.log(`
Next steps:
  1. Install the SpexCode packages (so \`spex\` and the dashboard run):
       cd <spec-cli> && npm install     # the package providing the \`spex\` CLI + server
  2. Edit .spec/project/spec.md to describe YOUR project, then grow child nodes beneath it.
  3. Set lint.governedRoots in spexcode.json to your source dir(s) — until you do, \`spex lint\`
     warns it is governing nothing (it ships pointing at "src").
  4. Start the backend and open the board:
       spex serve                       # http://localhost:8787
  5. \`spex lint\` should report 0 errors. Coverage warnings are your adoption TODO (source files no
     spec node claims yet). You're adopting SpexCode — the spec tree is now ground truth.`)
}
