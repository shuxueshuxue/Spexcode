import { isAbsolute } from 'node:path'

import {
  openProjectSessionApplication,
  type ProductionSessionApplication,
} from '@spexcode/session-application'
import { requireLocalDatabasePath } from '@spexcode/session-selflaunch'

let cached: ProductionSessionApplication | null | undefined

/**
 * The backend cut-in is deliberately opt-in through one explicit absolute path. Existing JSON-backed records are
 * left alone when the setting is absent; a configured but invalid path/locality result fails during backend use.
 */
export function configuredSessionApplication(): ProductionSessionApplication | null {
  if (cached !== undefined) return cached
  const databasePath = process.env.SPEXCODE_SESSION_DATABASE_PATH?.trim()
  if (!databasePath) {
    cached = null
    return cached
  }
  if (!isAbsolute(databasePath)) {
    throw new Error('SPEXCODE_SESSION_DATABASE_PATH must be an explicit absolute filesystem path')
  }
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

