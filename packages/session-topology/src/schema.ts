import type { ComponentMigration } from '@spexcode/session-protocol'

export const TOPOLOGY_MIGRATION_SQL = `
SELECT 1;
`

export const TOPOLOGY_MIGRATIONS: readonly ComponentMigration[] = [
  { version: 1, sql: TOPOLOGY_MIGRATION_SQL },
]
