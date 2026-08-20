import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

type DatabasePathErrorCode =
  | 'PROTOCOL_PATH_NOT_ABSOLUTE'
  | 'PROTOCOL_PATH_INVALID'
  | 'PROTOCOL_PATH_PARENT_MISSING'

export class DatabasePathError extends Error {
  readonly code: DatabasePathErrorCode

  constructor(code: DatabasePathErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'DatabasePathError'
    this.code = code
  }
}

export type SelfLaunchEnvironment = Readonly<Record<string, string | undefined>>

export interface ResolveDatabasePathOptions {
  databasePath?: string
  env?: SelfLaunchEnvironment
  readFile?: (path: string) => string
}

export function resolveDatabasePath(options: ResolveDatabasePathOptions = {}): string {
  const env = options.env ?? process.env
  let databasePath = options.databasePath ?? env.SPEX_SESSION_DATABASE_PATH

  if (databasePath === undefined && env.SPEX_SESSION_CONFIG) {
    const configPath = env.SPEX_SESSION_CONFIG
    let config: unknown
    try {
      config = JSON.parse((options.readFile ?? ((path: string) => readFileSync(path, 'utf8')))(configPath))
    } catch (error) {
      throw new DatabasePathError('PROTOCOL_PATH_INVALID', `could not read session config ${configPath}`, error)
    }
    if (
      typeof config !== 'object'
      || config === null
      || typeof (config as { databasePath?: unknown }).databasePath !== 'string'
      || !(config as { databasePath: string }).databasePath
    ) {
      throw new DatabasePathError('PROTOCOL_PATH_INVALID', `session config ${configPath} must contain databasePath`)
    }
    databasePath = (config as { databasePath: string }).databasePath
  }

  if (databasePath === undefined) {
    const home = env.SPEXCODE_HOME || (env.HOME ? join(env.HOME, '.spexcode') : undefined)
    if (!home) {
      throw new DatabasePathError('PROTOCOL_PATH_INVALID', 'HOME or SPEXCODE_HOME is required for the default database path')
    }
    databasePath = join(home, 'sessions.sqlite')
  }

  if (databasePath.length === 0) {
    throw new DatabasePathError('PROTOCOL_PATH_INVALID', 'databasePath must not be empty')
  }
  if (!isAbsolute(databasePath)) {
    throw new DatabasePathError('PROTOCOL_PATH_NOT_ABSOLUTE', 'databasePath must be absolute and is never resolved from cwd')
  }
  return databasePath
}
