import { existsSync } from 'node:fs'
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

/** The JSON-to-SQLite marker is the explicit cutover fence; before it exists, do not initialize a new store as a side effect of a read. */
export function configuredSessionApplicationIfCutover(): ProductionSessionApplication | undefined {
  const databasePath = resolveDatabasePath()
  if (!existsSync(`${databasePath}.json-migration.json`)) return undefined
  return configuredSessionApplication()
}

export function resetConfiguredSessionApplicationForTest(): void {
  cached?.close()
  cached = undefined
}
