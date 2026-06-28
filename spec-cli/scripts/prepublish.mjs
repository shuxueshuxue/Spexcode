// @@@ prepublish - runs once on `npm publish` (never on install). The published `spexcode` package must
// be self-contained: it carries the dashboard as a PREBUILT dist so an installed user never runs vite.
// The dist is produced by the sibling `spec-dashboard` package (outside this tarball), so we build it
// there and copy the result into ./dashboard-dist, which the `files` allowlist ships. A build failure is
// loud and aborts the publish — we never ship a stale or empty dashboard.
import { existsSync, rmSync, cpSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url))) // scripts/.. = spec-cli
const dashPkg = join(pkgRoot, '..', 'spec-dashboard')
const builtDist = join(dashPkg, 'dist')
const bundled = join(pkgRoot, 'dashboard-dist')

if (!existsSync(dashPkg)) {
  console.error(`[prepublish] sibling spec-dashboard not found at ${dashPkg} — cannot bundle the dashboard. Publish from the monorepo.`)
  process.exit(1)
}

console.log('[prepublish] building the dashboard (vite build)…')
const r = spawnSync('npm', ['run', 'build'], { cwd: dashPkg, stdio: 'inherit' })
if (r.status !== 0 || !existsSync(join(builtDist, 'index.html'))) {
  console.error('[prepublish] dashboard build failed — aborting publish. Run `npm install` in spec-dashboard, then `npm run build` there to debug.')
  process.exit(1)
}

rmSync(bundled, { recursive: true, force: true })
cpSync(builtDist, bundled, { recursive: true })
console.log(`[prepublish] bundled dashboard → ${bundled}`)
