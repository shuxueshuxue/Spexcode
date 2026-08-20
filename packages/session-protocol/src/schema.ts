import type { SessionProtocol } from './index.js'

export interface ComponentMigration {
  readonly version: number
  readonly sql: string
}

export const MIN_SQLITE_VERSION = '3.38.0'

export function applyComponentMigrations(
  _protocol: SessionProtocol,
  _component: string,
  migrations: readonly ComponentMigration[],
): number {
  return migrations.length
}
