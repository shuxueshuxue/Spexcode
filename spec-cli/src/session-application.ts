import { existsSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  openProjectSessionApplication,
  legacyResidueExists,
  migrateJsonSessionRecords,
  type CommittedSessionChange,
  type ProductionSessionApplication,
} from '@spexcode/session-application'
import { requireLocalDatabasePath, resolveDatabasePath } from '@spexcode/session-selflaunch'
import { runtimeRoot } from '@spexcode/spec-core'
import { jsonMigrationFencePath } from '@spexcode/session-application'

let cached: ProductionSessionApplication | undefined
let cachedPath: string | undefined
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
  const databasePath = resolveDatabasePath()
  if (cached !== undefined && cachedPath === databasePath) return cached
  if (cached !== undefined) cached.close()
  cached = openProjectSessionApplication({
    databasePath,
    locality: path => { requireLocalDatabasePath(path) },
    onCommitted: result => {
      commitWake(result.recipients)
      if (commitObserver) setImmediate(() => commitObserver?.(result))
    },
    onRuntimeBound: sessionId => commitWake([sessionId]),
  })
  cachedPath = databasePath
  return cached
}

export type SessionApplicationCutoverState = 'ready' | 'residue' | 'fresh' | 'migration-required' | 'fenced' | 'ambiguous'

// A marked store is `ready` only once its legacy tree holds nothing left to absorb. The scan runs once per process
// per store: after residue is migrated (or none was found) no legacy writer exists to create more, so later calls
// answer from memory instead of walking every session directory on the hot path.
const settledResidueStores = new Set<string>()

/** Inspect cutover state without initializing a fresh database as a side effect of a rejected request. */
export function sessionApplicationCutoverState(): SessionApplicationCutoverState {
  const databasePath = resolveDatabasePath()
  const recordsRoot = join(runtimeRoot(), 'sessions')
  const storeKey = `${databasePath}\0${recordsRoot}`
  if (existsSync(`${databasePath}.json-migration.json`)) {
    if (settledResidueStores.has(storeKey)) return 'ready'
    if (legacyResidueExists(recordsRoot)) return 'residue'
    settledResidueStores.add(storeKey)
    return 'ready'
  }
  if (existsSync(jsonMigrationFencePath(recordsRoot))) return 'fenced'
  if (existsSync(recordsRoot) && readdirSync(recordsRoot, { withFileTypes: true }).some(entry => entry.isDirectory())) return 'migration-required'
  if (existsSync(databasePath)) return 'ambiguous'
  return 'fresh'
}

/** Resolve the canonical application. A legacy tree is cut over at its first canonical access; runtime code
 * never gets to choose between JSON and SQLite based on the caller or request path. */
export function configuredSessionApplicationIfCutover(): ProductionSessionApplication | undefined {
  const state = sessionApplicationCutoverState()
  if (state === 'ready') return configuredSessionApplication()
  if (state === 'migration-required' || state === 'residue') return initializeMigratedSessionApplication(state)
  if (state === 'fresh') return initializeFreshSessionApplication()
  if (state === 'fenced' || state === 'ambiguous') {
    throw new Error(`session application cutover is ${state}; refusing a legacy/runtime split`)
  }
  return undefined
}

// One importer for both shapes of legacy tree. Before the marker it installs the canonical store; after the
// marker it absorbs whatever residue the tree still holds into the store this process already owns, then
// retires the tree. Either way the tree is gone when this returns, so the cutover state settles to `ready`.
function initializeMigratedSessionApplication(state: 'migration-required' | 'residue'): ProductionSessionApplication {
  const databasePath = resolveDatabasePath()
  const recordsRoot = join(runtimeRoot(), 'sessions')
  const locality = (path: string) => { requireLocalDatabasePath(path) }
  if (state === 'migration-required') {
    migrateJsonSessionRecords({ databasePath, recordsRoot, locality })
    return configuredSessionApplication()
  }
  const application = configuredSessionApplication()
  const report = migrateJsonSessionRecords({ databasePath, recordsRoot, locality, application })
  settledResidueStores.add(`${databasePath}\0${recordsRoot}`)
  const residue = report.residue
  if (residue) {
    console.log(`[session-application] migrated legacy residue from ${recordsRoot}: ${residue.records} record(s), ${residue.events} event(s), ${residue.parentEdges} parent edge(s), ${residue.watchEdges} watch edge(s), ${residue.pending} pending; ${residue.unclaimed.length} unclaimed dir(s)${residue.unclaimed.length ? ` (${residue.unclaimed.join(', ')})` : ''}; backup ${residue.backupRoot}`)
  }
  return application
}

/** Initialize a fresh canonical store only after an accepted create has crossed its no-side-effect boundary. */
export function initializeFreshSessionApplication(): ProductionSessionApplication {
  const state = sessionApplicationCutoverState()
  if (state === 'ready') return configuredSessionApplication()
  if (state === 'residue') return initializeMigratedSessionApplication(state)
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
  if (state === 'residue') return { application: initializeMigratedSessionApplication(state), owned: false }
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
  settledResidueStores.clear()
  freshStoreOwned = false
  freshStoreCommitted = false
  freshStoreLeases = 0
}
