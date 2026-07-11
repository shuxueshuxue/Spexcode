import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, chmodSync, writeFileSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { readConfig, readJsonConfig } from './layout.js'
import { resolveHarnessTargets } from './harness-select.js'

// this file lives at <pkgRoot>/src/init.ts, so `..` is the package root — the same derivation the
// launch paths use, never a hardcoded repo path (so a relocated/installed package still finds its data).
const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const TEMPLATES = join(pkgRoot, 'templates')

// the cumulative preset chain, lean → cautious (see [[init-preset]]). `default` is the live `.config`
// instance set (planted from templates/spec); every higher tier is a SEPARATE package under
// templates/presets/<tier>/ that seeding stacks ON TOP — a superset, so selecting `careful` seeds the
// default set PLUS the careful package. Selection matters ONLY here at seed time; the running repo just
// walks whatever `.config` ended up planted, so there is no launcher-side preset gate.
const PRESET_TIERS = ['default', 'careful'] as const
const presetRank = (name: string): number => (PRESET_TIERS as readonly string[]).indexOf(name)

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

export async function specInit(targetArg: string | undefined, presetArg?: string): Promise<void> {
  const targetDir = resolve(targetArg ?? process.cwd())

  // the preset the NEW adopter gets — `--preset <name>` wins, else an existing target spexcode.json's
  // `preset` field, else the lean `default`. Validated loudly against the chain (an unknown name would
  // otherwise seed silently). A non-default tier stacks its template package on top of the default set below.
  const selected = (presetArg ?? '').trim() || (readConfig(targetDir).preset ?? '').trim() || 'default'
  if (!(PRESET_TIERS as readonly string[]).includes(selected)) {
    console.error(`spex init: unknown preset '${selected}'. Valid presets (cumulative, lean→cautious): ${PRESET_TIERS.join(', ')}.`)
    process.exit(1)
  }

  // SpexCode is git-backed: git IS the version database and the hooks live in `.git`. A non-git target
  // would leave a HALF-STATE — specs on disk but no version history, no hooks, no harness shims, no
  // sessions. So fail LOUD before writing anything, rather than seeding debris and warning past it. We do
  // NOT `git init` for them: creating a repo is a side effect beyond init's remit (a subdir, a dir not
  // meant as a repo root), and `git init` is one deliberate command.
  try {
    execFileSync('git', ['-C', targetDir, 'rev-parse', '--is-inside-work-tree'], { stdio: ['ignore', 'ignore', 'ignore'] })
  } catch {
    console.error(`spex init: ${targetDir} is not a git repository. SpexCode is git-backed (git is the version database; the hooks live in .git). Run \`git init\` there first, then \`spex init\`.`)
    process.exit(1)
  }

  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
  console.log(`spex init → ${targetDir}`)

  // 1. seed the spec tree: templates/spec/* -> <dir>/.spec/* (an existing .spec aborts this phase loudly).
  const specDest = join(targetDir, '.spec')
  if (existsSync(specDest)) {
    console.warn(`• .spec already exists at ${specDest} — skipping spec scaffold (won't overwrite an existing tree).`)
  } else {
    const planted = copyTreeNoClobber(join(TEMPLATES, 'spec'), specDest, targetDir)
    console.log(`✓ seeded ${planted.length} spec file(s) under .spec/ (root 'project' node + default .config)`)
    // 1a. stack the selected preset's package(s) ON TOP of the default set — cumulative, so every tier from
    // just above `default` up to the selection is planted. Each lives under templates/presets/<tier>/ mirroring
    // the default layout (its `.config/<plugin>` lands in the seeded project node's `.config`). See [[init-preset]].
    for (let r = 1; r <= presetRank(selected); r++) {
      const tier = PRESET_TIERS[r]
      const pkg = join(TEMPLATES, 'presets', tier)
      if (!existsSync(pkg)) { console.warn(`• preset '${tier}' has no package at ${pkg} — skipped.`); continue }
      const added = copyTreeNoClobber(pkg, join(specDest, 'project'), targetDir)
      console.log(`✓ seeded preset '${tier}' (${added.length} file(s)) into .config`)
    }
  }

  // 1b. plant a starter spexcode.json (the lint/layout knob). The success message reports the value the
  // template ACTUALLY ships (read from the planted file, never restated as a string literal here — the two
  // once drifted: the message claimed ["src"] while the template seeded ["."]).
  const cfgDest = join(targetDir, 'spexcode.json')
  if (existsSync(cfgDest)) {
    console.warn(`• spexcode.json already exists at ${cfgDest} — left untouched.`)
  } else {
    copyFileSync(join(TEMPLATES, 'spexcode.json'), cfgDest)
    const roots = JSON.stringify(readJsonConfig(cfgDest)?.lint?.governedRoots ?? null)
    console.log(`✓ planted spexcode.json — lint.governedRoots starts as ${roots} (the whole git-tracked tree, tests excluded); curate explicit roots later if you want a narrower graph`)
  }

  // validate the harness DELIVERY TARGET set ([[harness-select]]) up front: a bad `harnesses` set (plugin +
  // native, or a plugin with no folder) must fail LOUD here, not be silently swallowed by the materialize
  // try/catch below. A fresh starter spexcode.json omits the field (defaults to all natives), so this only
  // bites a hand-edited or re-init'd config — exactly where a clear error belongs.
  try {
    resolveHarnessTargets(readConfig(targetDir).harnesses)
  } catch (e) {
    console.error(`spex init: ${(e as Error).message}`)
    process.exit(1)
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

  // 2c. MATERIALIZE the harness-discovered artifacts so a USER-self-launched claude/codex works with zero further
  // steps: the hook manifest (in the GLOBAL per-project store, not the worktree), the AGENTS.md/CLAUDE.md
  // <spexcode> contract block (user content preserved), the .claude/.codex shims, and the Codex trust (global,
  // scoped) so codex self-launch is prompt-free. Runs with cwd = the target so the loaders read the just-seeded
  // .config. Idempotent — the planted git hooks (pre-commit/post-checkout/post-merge) keep it fresh
  // thereafter on the git-native anchors ([[commit-surgery]]); no harness event ever triggers a materialize.
  const prevCwd = process.cwd()
  try {
    process.chdir(targetDir)
    const { materialize } = await import('./materialize.js')
    materialize(targetDir)
    console.log('✓ materialized harness artifacts (global hook manifest, AGENTS.md/CLAUDE.md block, harness shims, Codex trust)')
  } catch (e) {
    console.warn(`• materialize skipped (${(e as Error).message}) — run \`spex materialize\` once the packages are installed.`)
  } finally {
    process.chdir(prevCwd)
  }

  // 3. next steps — what the human must do to bring the instance to life. The governedRoots line reads the
  // LIVE value (the planted starter's, or a pre-existing config's) so it can never drift from what's on disk.
  const rootsNow = JSON.stringify(readJsonConfig(cfgDest)?.lint?.governedRoots ?? null)
  console.log(`
Next steps:
  1. Edit .spec/project/spec.md to describe YOUR project, then grow child nodes beneath it.
  2. lint.governedRoots in spexcode.json (currently ${rootsNow}) names what \`spex lint\` governs —
     ["."] governs the whole git-tracked tree (tests excluded); narrow it to explicit source roots
     when you want a curated graph.
  3. Start the backend and open the board:
       spex serve                       # http://localhost:8787
  4. \`spex lint\` should report 0 errors. Coverage warnings are your adoption TODO (source files no
     spec node claims yet). You're adopting SpexCode — the spec tree is now ground truth.
  (On a fresh CLONE, re-run \`spex init\` — git never clones .git/hooks/, and the harness shims are
   gitignored machine-local files that regenerate per-machine.)`)
}
