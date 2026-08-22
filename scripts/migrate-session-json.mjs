#!/usr/bin/env node
import { join, resolve } from 'node:path'
import { migrateJsonSessionRecords } from '@spexcode/session-application'
import { resolveDatabasePath, requireLocalDatabasePath } from '@spexcode/session-selflaunch'
import { runtimeRoot } from '@spexcode/spec-core'

const args = process.argv.slice(2)
const value = (name) => {
  const index = args.indexOf(name)
  return index < 0 ? undefined : args[index + 1]
}
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/migrate-session-json.mjs [--records-root ABSOLUTE_DIR] [--database ABSOLUTE_FILE] [--backup-root ABSOLUTE_DIR] [--orphan-parent tombstone]')
  process.exit(0)
}

const recordsRoot = resolve(value('--records-root') ?? join(runtimeRoot(), 'sessions'))
const databasePath = value('--database') ?? resolveDatabasePath()
const backupRoot = value('--backup-root')
const orphanParent = value('--orphan-parent')
if (orphanParent !== undefined && orphanParent !== 'tombstone') {
  throw new Error('--orphan-parent only accepts tombstone')
}
const report = migrateJsonSessionRecords({
  recordsRoot,
  databasePath,
  ...(backupRoot ? { backupRoot: resolve(backupRoot) } : {}),
  ...(orphanParent ? { orphanParentPolicy: 'tombstone' } : {}),
  locality: path => requireLocalDatabasePath(path),
})
console.log(JSON.stringify(report, null, 2))
