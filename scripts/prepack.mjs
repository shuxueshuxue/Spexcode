// @@@ prepack - runs before npm BUILDS A TARBALL: both `npm pack` and `npm publish` fire prepack (never on
// a plain `npm install`), so pack and publish produce the IDENTICAL complete tarball. The published
// `spexcode` is a thin metapackage. Each runtime package publishes its own dist; the root's bundled CLI
// dependency closes the default CLI graph, while the dashboard stays a separate package.
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
const build = (dir, script, output) => {
  console.log(`[prepack] ${dir}: npm run ${script}…`)
  const result = spawnSync('npm', ['run', script], { cwd: join(root, dir), stdio: 'inherit' })
  if (result.status !== 0 || !existsSync(join(root, dir, output))) {
    console.error(`[prepack] ${dir} ${script} failed — aborting.`)
    process.exit(1)
  }
}
build('packages/spec-core', 'build', 'dist/index.js')
build('spec-eval', 'build', 'dist/index.js')
build('spec-forge', 'build', 'dist/index.js')
build('spec-cli', 'build', 'dist/cli.js')
