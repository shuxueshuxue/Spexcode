import {
  openProjectSessionApplication,
  type ProductionSessionApplication,
} from '@spexcode/session-application'
import { requireLocalDatabasePath, resolveDatabasePath } from '@spexcode/session-selflaunch'

let cached: ProductionSessionApplication | undefined

/** The backend's sole session application composition. Path selection is shared with self-launch. */
export function configuredSessionApplication(): ProductionSessionApplication {
  if (cached !== undefined) return cached
  const databasePath = resolveDatabasePath()
  cached = openProjectSessionApplication({
    databasePath,
    locality: path => { requireLocalDatabasePath(path) },
  })
  return cached
}

export function resetConfiguredSessionApplicationForTest(): void {
  cached?.close()
  cached = undefined
}
