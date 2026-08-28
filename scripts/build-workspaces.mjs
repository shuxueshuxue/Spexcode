import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildScript = fileURLToPath(new URL('./build-dist.mjs', import.meta.url))

// Keep the release dependency order, but avoid starting npm's workspace runner for every package.
const packages = [
  'packages/session-protocol',
  'packages/session-topology',
  'packages/session-runtime',
  'packages/session-events',
  'packages/session-application',
  'packages/session-selflaunch',
  'packages/spec-core',
  'spec-eval',
  'spec-forge',
  'spec-cli',
]

for (const packagePath of packages) {
  const build = spawnSync(process.execPath, [buildScript], {
    cwd: join(root, packagePath),
    stdio: 'inherit',
  })
  if (build.error) throw build.error
  if (build.status !== 0) process.exit(build.status ?? 1)
}
