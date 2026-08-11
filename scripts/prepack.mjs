// @@@ prepack - runs before npm BUILDS A TARBALL: both `npm pack` and `npm publish` fire prepack (never on
// a plain `npm install`), so pack and publish produce the IDENTICAL complete tarball. The published
// `spexcode` package is the monorepo ROOT's runtime subset, shipped with the layout PRESERVED (spec-cli/ +
// spec-eval/src + spec-forge/src + spec-dashboard/dist) so the cross-package `../../spec-*` imports resolve
// in-package with zero import rewriting. The one thing not in git is the dashboard build, so build it here →
// spec-dashboard/dist, which the `files` allowlist ships. A build failure is loud and aborts the pack/publish.
//
// TWO builds, because the graph-only mode is decided at BUILD time (VITE_PUBLIC_GRAPH_ONLY bakes into the
// bundle), so the full dashboard cannot serve as the read-only shell. [[flat]]'s `spex flat site` copies that
// shell beside a flat's own payload — the shell is identical for every flat, only the payload differs, which
// is how a flat renders with no backend and no build step of its own. Ship only `dist` and `flat site` works
// in this checkout and nowhere else: an installed user has no `npm run build:public` to be told to run.
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url))) // scripts/.. = repo root
const dashPkg = join(root, 'spec-dashboard')
if (!existsSync(dashPkg)) {
  console.error(`[prepack] spec-dashboard not found at ${dashPkg} — cannot build the dashboard. Pack from the monorepo.`)
  process.exit(1)
}

console.log('[prepack] building the dashboard (vite build)…')
const r = spawnSync('npm', ['run', 'build'], { cwd: dashPkg, stdio: 'inherit' })
if (r.status !== 0 || !existsSync(join(dashPkg, 'dist', 'index.html'))) {
  console.error('[prepack] dashboard build failed — aborting. Run `npm install` in spec-dashboard, then `npm run build` there to debug.')
  process.exit(1)
}
console.log(`[prepack] dashboard built → ${join(dashPkg, 'dist')}`)

console.log('[prepack] building the graph-only shell (vite build, VITE_PUBLIC_GRAPH_ONLY=1)…')
// --base ./ so the emitted shell references its own assets relatively: a flat is a directory, and a gallery
// serves many of them under path prefixes. Root-served hosts are unaffected — at `/` the two forms coincide.
const p = spawnSync('npm', ['run', 'build', '--', '--outDir', 'dist-public', '--base', './'], {
  cwd: dashPkg,
  stdio: 'inherit',
  env: { ...process.env, VITE_PUBLIC_GRAPH_ONLY: '1' },
})
if (p.status !== 0 || !existsSync(join(dashPkg, 'dist-public', 'index.html'))) {
  console.error('[prepack] graph-only shell build failed — aborting. `spex flat site` would ship broken.')
  process.exit(1)
}
console.log(`[prepack] graph-only shell built → ${join(dashPkg, 'dist-public')}`)
