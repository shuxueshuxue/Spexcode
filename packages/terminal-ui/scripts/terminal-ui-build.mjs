import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const patch = spawnSync(process.execPath, [join(packageRoot, 'scripts', 'patch-xterm-sync-resize.mjs')], { cwd: packageRoot, stdio: 'inherit' })
if (patch.status !== 0) process.exit(patch.status ?? 1)
const build = spawnSync(process.execPath, [join(packageRoot, '..', '..', 'scripts', 'build-dist.mjs')], { cwd: packageRoot, stdio: 'inherit' })
process.exit(build.status ?? 1)
