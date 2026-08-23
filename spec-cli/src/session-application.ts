import { existsSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  openProjectSessionApplication,
  migrateJsonSessionRecords,
  type CommittedSessionChange,
  type ProductionSessionApplication,
} from '@spexcode/session-application'
import { requireLocalDatabasePath, resolveDatabasePath } from '@spexcode/session-selflaunch'
import { runtimeRoot } from '@spexcode/spec-core'
import { jsonMigrationFencePath } from '@spexcode/session-application'

let cached: ProductionSessionApplication | undefined
let freshStoreOwned = false
let freshStoreCommitted = false
let freshStoreLeases = 0

type SessionApplicationCommitWake = (recipients: readonly string[]) => void
let commitWake: SessionApplicationCommitWake = () => {}
let commitObserver: ((change: Pick<CommittedSessionChange, 'recipients'>) => void) | undefined

/** The application owns commit ordering; Spex supplies the adopter transport wake. */
export function setSessionApplicationCommitWake(wake: SessionApplicationCommitWake): void {
  commitWake = wake
}

/** Allow the adopter to refresh its board stream after the canonical transaction commits. */
export function setSessionApplicationCommitObserver(observer: (change: Pick<CommittedSessionChange, 'recipients'>) => void): void {
  commitObserver = observer
}

/** The backend's sole session application composition. Path selection is shared with self-launch. */
export function configuredSessionApplication(): ProductionSessionApplication {
  if (cached !== undefined) return cached
  const databasePath = resolveDatabasePath()
  cached = openProjectSessionApplication({
    databasePath,
    locality: path => { requireLocalDatabasePath(path) },
    onCommitted: result => {
      commitWake(result.recipients)
      if (commitObserver) setImmediate(() => commitObserver?.(result))
    },
  })
  return cached
}

export type SessionApplicationCutoverState = 'ready' | 'fresh' | 'migration-required' | 'fenced' | 'ambiguous'

/** Inspect cutover state without initializing a fresh database as a side effect of a rejected request. */
export function sessionApplicationCutoverState(): SessionApplicationCutoverState {
  const databasePath = resolveDatabasePath()
  if (existsSync(`${databasePath}.json-migration.json`)) return 'ready'
  const recordsRoot = join(runtimeRoot(), 'sessions')
  if (existsSync(jsonMigrationFencePath(recordsRoot))) return 'fenced'
  if (existsSync(recordsRoot) && readdirSync(recordsRoot, { withFileTypes: true }).some(entry => entry.isDirectory())) return 'migration-required'
  if (existsSync(databasePath)) return 'ambiguous'
  return 'fresh'
}

/** Resolve the canonical application only when its marker already exists; reads never initialize a fresh store. */
export function configuredSessionApplicationIfCutover(): ProductionSessionApplication | undefined {
  const state = sessionApplicationCutoverState()
  if (state === 'ready') return configuredSessionApplication()
  return undefined
}

/** Initialize a fresh canonical store only after an accepted create has crossed its no-side-effect boundary. */
export function initializeFreshSessionApplication(): ProductionSessionApplication {
  const state = sessionApplicationCutoverState()
  if (state === 'ready') return configuredSessionApplication()
  if (state !== 'fresh') throw new Error(`cannot initialize a fresh session store from cutover state: ${state}`)
  const databasePath = resolveDatabasePath()
  const recordsRoot = join(runtimeRoot(), 'sessions')
  migrateJsonSessionRecords({ databasePath, recordsRoot, locality: path => { requireLocalDatabasePath(path) } })
  return configuredSessionApplication()
}

export function acquireFreshSessionApplicationForCreate(): { application: ProductionSessionApplication; owned: boolean } {
  const state = sessionApplicationCutoverState()
  if (state === 'fresh') {
    const application = initializeFreshSessionApplication()
    freshStoreOwned = true
    freshStoreCommitted = false
    freshStoreLeases++
    return { application, owned: true }
  }
  if (state === 'ready' && freshStoreOwned && !freshStoreCommitted) {
    freshStoreLeases++
    return { application: configuredSessionApplication(), owned: true }
  }
  if (state !== 'ready') throw new Error(`cannot initialize a session store from cutover state: ${state}`)
  return { application: configuredSessionApplication(), owned: false }
}

export function releaseFreshSessionApplicationForCreate(owned: boolean, committed: boolean): void {
  if (!owned) return
  if (committed) freshStoreCommitted = true
  freshStoreLeases = Math.max(0, freshStoreLeases - 1)
  if (freshStoreLeases !== 0) return
  if (freshStoreCommitted) {
    try { unlinkSync(jsonMigrationFencePath(join(runtimeRoot(), 'sessions'))) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return
  }
  const application = cached
  const rows = application?.protocol.withTransaction(tx => Number(tx.query('SELECT COUNT(*) AS count FROM session_application_state')[0]?.count ?? 0)) ?? 0
  if (rows !== 0) {
    freshStoreCommitted = true
    try { unlinkSync(jsonMigrationFencePath(join(runtimeRoot(), 'sessions'))) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return
  }
  application?.close()
  cached = undefined
  const databasePath = resolveDatabasePath()
  const recordsRoot = join(runtimeRoot(), 'sessions')
  for (const path of [databasePath, `${databasePath}.json-migration.json`, jsonMigrationFencePath(recordsRoot)]) {
    try { unlinkSync(path) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  rmSync(`${databasePath}.json-migration-backup`, { recursive: true, force: true })
  freshStoreOwned = false
}

export function resetConfiguredSessionApplicationForTest(): void {
  cached?.close()
  cached = undefined
  freshStoreOwned = false
  freshStoreCommitted = false
  freshStoreLeases = 0
}
