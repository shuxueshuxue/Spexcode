// @@@ prepublish - runs once on `npm publish` (never on install). The published `spexcode` package is the
// monorepo ROOT's runtime subset, shipped with the layout PRESERVED (spec-cli/ + spec-yatsu/src +
// spec-forge/src + spec-dashboard/dist) so the cross-package `../../spec-*` imports resolve in-package with
// zero import rewriting. The one thing not in git is the dashboard build, so build it here →
// spec-dashboard/dist, which the `files` allowlist ships. A build failure is loud and aborts the publish.
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url))) // scripts/.. = repo root
const dashPkg = join(root, 'spec-dashboard')
if (!existsSync(dashPkg)) {
  console.error(`[prepublish] spec-dashboard not found at ${dashPkg} — cannot build the dashboard. Publish from the monorepo.`)
  process.exit(1)
}

console.log('[prepublish] building the dashboard (vite build)…')
const r = spawnSync('npm', ['run', 'build'], { cwd: dashPkg, stdio: 'inherit' })
if (r.status !== 0 || !existsSync(join(dashPkg, 'dist', 'index.html'))) {
  console.error('[prepublish] dashboard build failed — aborting publish. Run `npm install` in spec-dashboard, then `npm run build` there to debug.')
  process.exit(1)
}
console.log(`[prepublish] dashboard built → ${join(dashPkg, 'dist')}`)
