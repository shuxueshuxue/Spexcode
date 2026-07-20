import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, chmodSync, writeFileSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { readConfig, readJsonConfig } from './layout.js'
import { resolveHarnessTargets, parseHarnessFlag, NATIVE_HARNESS_IDS } from './harness-select.js'

// this file lives at <pkgRoot>/src/init.ts, so `..` is the package root — the same derivation the
// launch paths use, never a hardcoded repo path (so a relocated/installed package still finds its data).
const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const TEMPLATES = join(pkgRoot, 'templates')

// the cumulative preset chain, lean → cautious (see [[init-preset]]). `default` is the live `.plugins`
// instance set (planted from templates/spec); a higher tier would be a SEPARATE package under
// templates/presets/<tier>/ that seeding stacks ON TOP — a superset. No non-default tier ships today
// (the `careful` package was retired); the chain mechanism stays for when one earns its keep.
// Selection matters ONLY here at seed time; the running repo just
// walks whatever `.plugins` ended up planted, so there is no launcher-side preset gate.
const PRESET_TIERS = ['default'] as const
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

export async function specInit(targetArg: string | undefined, presetArg?: string, harnessArg?: string): Promise<void> {
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

  // the harness DELIVERY TARGET set ([[harness-select]]) is a REQUIRED, explicit choice — `--harness <ids>`
  // stamps it into spexcode.json; absent the flag, a pre-existing explicit `harnesses` field IS the choice.
  // Neither → abort BEFORE writing anything: with many harnesses, a silent "deliver to all" would litter the
  // adopter's tree (and global tool configs) with artifacts for harnesses they never installed. Legality
  // (unknown ids, plugin exclusivity, empty set) fails loud here too, not as a soft materialize warning.
  const flagRaw = (harnessArg ?? '').trim() ? parseHarnessFlag(harnessArg!.trim()) : null
  const chosenHarnesses = flagRaw ?? readConfig(targetDir).harnesses ?? null
  if (chosenHarnesses === null) {
    console.error(`spex init: --harness is required — name the harness(es) this repo delivers into, e.g. \`spex init --harness claude\`. Known native ids: ${NATIVE_HARNESS_IDS.join(', ')} (comma-separate several; a plugin bundle: --harness plugin:<folder>). A pre-existing spexcode.json "harnesses" field also satisfies this.`)
    process.exit(1)
  }
  try {
    resolveHarnessTargets(chosenHarnesses)
  } catch (e) {
    console.error(`spex init: ${(e as Error).message}`)
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
    console.log(`✓ seeded ${planted.length} spec file(s) under .spec/ (root 'project' node + default .plugins)`)
    // 1a. stack the selected preset's package(s) ON TOP of the default set — cumulative, so every tier from
    // just above `default` up to the selection is planted. Each lives under templates/presets/<tier>/ mirroring
    // the default layout (its `.plugins/<plugin>` lands in the seeded project node's `.plugins`). See [[init-preset]].
    for (let r = 1; r <= presetRank(selected); r++) {
      const tier = PRESET_TIERS[r]
      const pkg = join(TEMPLATES, 'presets', tier)
      if (!existsSync(pkg)) { console.warn(`• preset '${tier}' has no package at ${pkg} — skipped.`); continue }
      const added = copyTreeNoClobber(pkg, join(specDest, 'project'), targetDir)
      console.log(`✓ seeded preset '${tier}' (${added.length} file(s)) into .plugins`)
    }
  }

  // 1b. plant a starter spexcode.json (the lint/layout knob) carrying the CHOSEN `harnesses` set. The
  // template ships launchers for every native harness; seeding keeps only the SELECTED ones (a launcher for
  // a tool the adopter didn't pick is exactly the litter --harness exists to prevent) — a plugin-only
  // selection keeps them all, since the bundle serves the HOST agent while dispatched sessions still need a
  // launcher. The success message reports values read back from the planted file, never restated literals.
  const cfgDest = join(targetDir, 'spexcode.json')
  const nativeChosen = (chosenHarnesses as unknown[]).filter((m): m is string => typeof m === 'string')
  if (existsSync(cfgDest)) {
    if (flagRaw) {
      // an explicit --harness on a re-init is a deliberate command: restamp THAT field, touch nothing else.
      const cfg = (readJsonConfig(cfgDest) ?? {}) as Record<string, unknown>
      cfg.harnesses = flagRaw
      writeFileSync(cfgDest, JSON.stringify(cfg, null, 2) + '\n')
      console.log(`✓ stamped "harnesses": ${JSON.stringify(flagRaw)} into the existing spexcode.json (other fields untouched)`)
    } else {
      console.warn(`• spexcode.json already exists at ${cfgDest} — left untouched (harnesses: ${JSON.stringify(chosenHarnesses)}).`)
    }
  } else {
    const cfg = (readJsonConfig(join(TEMPLATES, 'spexcode.json')) ?? {}) as Record<string, any>
    cfg.harnesses = chosenHarnesses
    if (nativeChosen.length && cfg.sessions?.launchers) {
      cfg.sessions.launchers = Object.fromEntries(
        Object.entries(cfg.sessions.launchers as Record<string, { harness?: string }>).filter(([, l]) => nativeChosen.includes(l.harness ?? 'claude')))
      const names = Object.keys(cfg.sessions.launchers)
      if (names.length) cfg.sessions.defaultLauncher = names[0]
    }
    writeFileSync(cfgDest, JSON.stringify(cfg, null, 2) + '\n')
    const roots = JSON.stringify(readJsonConfig(cfgDest)?.lint?.governedRoots ?? null)
    console.log(`✓ planted spexcode.json — harnesses ${JSON.stringify(chosenHarnesses)}, launchers ${JSON.stringify(Object.keys(cfg.sessions?.launchers ?? {}))}; lint.governedRoots starts as ${roots} (the whole git-tracked tree, tests excluded)`)
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

  // 2c. MATERIALIZE the harness-discovered artifacts so a USER-self-launched harness works with zero further
  // steps. Runs with cwd = the target so the loaders read the just-seeded
  // .plugins. Idempotent — the planted git hooks (pre-commit/post-checkout/post-merge) keep it fresh
  // thereafter on the git-native anchors ([[commit-surgery]]); no harness event ever triggers a materialize.
  const prevCwd = process.cwd()
  try {
    process.chdir(targetDir)
    const { materialize } = await import('./materialize.js')
    const result = materialize(targetDir)
    const display = (path: string) => {
      const local = relative(targetDir, path)
      return local && local !== '..' && !local.startsWith('../') && !local.startsWith('..\\') ? local : path
    }
    console.log(`✓ materialized harness artifacts (${result.planted.map((a) => `${a.kind}: ${display(a.path)}`).join(', ')})`)
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
  2. lint.governedRoots in spexcode.json (currently ${rootsNow}) names what \`spex spec lint\` governs —
     ["."] governs the whole git-tracked tree (tests excluded); narrow it to explicit source roots
     when you want a curated graph.
  3. Start the backend and open the dashboard:
       spex serve                       # http://localhost:8787
  4. \`spex spec lint\` should report 0 errors. Coverage warnings are your adoption TODO (source files no
     spec node claims yet). You're adopting SpexCode — the spec tree is now ground truth.
  (On a fresh CLONE, re-run \`spex init\` — git never clones .git/hooks/, and the harness shims are
   gitignored machine-local files that regenerate per-machine.)`)
}
