import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  openProjectSessionApplication,
  migrateJsonSessionRecords,
  type ProductionSessionApplication,
} from '@spexcode/session-application'
import { requireLocalDatabasePath, resolveDatabasePath } from '@spexcode/session-selflaunch'
import { runtimeRoot } from '@spexcode/spec-core'
import { jsonMigrationFencePath } from '@spexcode/session-application'

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
  if (existsSync(`${databasePath}.json-migration.json`)) return configuredSessionApplication()
  const recordsRoot = join(runtimeRoot(), 'sessions')
  if (existsSync(jsonMigrationFencePath(recordsRoot))) return undefined
  if (existsSync(recordsRoot) && readdirSync(recordsRoot, { withFileTypes: true }).some(entry => entry.isDirectory())) return undefined
  if (existsSync(databasePath)) return undefined
  migrateJsonSessionRecords({ databasePath, recordsRoot, locality: path => { requireLocalDatabasePath(path) } })
  return configuredSessionApplication()
}

export function resetConfiguredSessionApplicationForTest(): void {
  cached?.close()
  cached = undefined
}
