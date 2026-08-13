import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

export type DashboardArtifact = 'dist' | 'dist-public'

export class DashboardAssetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DashboardAssetError'
  }
}

const PACKAGE = '@spexcode/spec-dashboard'
const INSTALL = `npm install ${PACKAGE}`

function dashboardRoot(): string {
  try {
    return dirname(createRequire(import.meta.url).resolve(`${PACKAGE}/package.json`))
  } catch {
    throw new DashboardAssetError(`dashboard UI is not installed (${PACKAGE}). Install it with: ${INSTALL}`)
  }
}

// Dashboard assets belong to the dashboard package. Resolving its manifest handles both an npm dependency
// and a workspace link without teaching CLI code where either layout happens to live.
export function dashboardArtifactDir(artifact: DashboardArtifact): string {
  const root = dashboardRoot()
  const dir = join(root, artifact)
  if (existsSync(join(dir, 'index.html'))) return dir
  const repair = existsSync(join(root, 'src'))
    ? `build the dashboard package before running this command`
    : `reinstall ${PACKAGE}`
  throw new DashboardAssetError(`dashboard UI package is incomplete: missing ${artifact}/index.html at ${root}. To repair, ${repair}.`)
}

export function ensureDashboardArtifact(artifact: DashboardArtifact): string {
  try { return dashboardArtifactDir(artifact) }
  catch (error) {
    if (!(error instanceof DashboardAssetError)) throw error
    const root = dashboardRoot()
    if (!existsSync(join(root, 'src'))) throw error
    const script = artifact === 'dist' ? 'build' : 'build:public'
    console.log(`[dashboard] ${artifact} is not built — running npm run ${script} in ${PACKAGE}…`)
    const result = spawnSync('npm', ['run', script], { cwd: root, stdio: 'inherit' })
    if (result.status === 0) return dashboardArtifactDir(artifact)
    throw new DashboardAssetError(`dashboard UI build failed for ${PACKAGE}. Repair it with: (cd ${root} && npm run ${script})`)
  }
}
