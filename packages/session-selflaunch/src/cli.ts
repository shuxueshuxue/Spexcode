import type { Message, SessionProtocol } from '@spexcode/session-protocol'

import { LocalityError, requireLocalDatabasePath } from './locality.js'
import { DatabasePathError, resolveDatabasePath } from './path.js'
import type { SelfLaunchEnvironment } from './path.js'

class UsageError extends Error {
  readonly code = 'USAGE'
}

type CommandName = 'initialize' | 'enqueue' | 'dequeue' | 'pending'

interface ParsedCommand {
  readonly command: CommandName
  readonly values: ReadonlyMap<string, string>
  readonly headers: readonly [string, string][]
  readonly assumeLocal: boolean
}

const VALUE_FLAGS: Readonly<Record<CommandName, ReadonlySet<string>>> = {
  initialize: new Set(['session-id', 'database-path']),
  enqueue: new Set(['session-id', 'kind', 'body', 'sender-session-id', 'idempotency-key', 'database-path']),
  dequeue: new Set(['session-id', 'database-path']),
  pending: new Set(['session-id', 'database-path']),
}

const usage = (): never => {
  throw new UsageError(
    'usage: spex-session initialize|enqueue|dequeue|pending --session-id ID [command options]',
  )
}

const isCommandName = (value: string | undefined): value is CommandName => (
  value === 'initialize' || value === 'enqueue' || value === 'dequeue' || value === 'pending'
)

export function parseCommand(argv: readonly string[]): ParsedCommand {
  const command = argv[0]
  if (!isCommandName(command)) return usage()
  const commandName: CommandName = command

  const values = new Map<string, string>()
  const headers: [string, string][] = []
  let assumeLocal = false
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--assume-local-storage') {
      if (assumeLocal) throw new UsageError('duplicate --assume-local-storage')
      assumeLocal = true
      continue
    }
    if (!token.startsWith('--')) throw new UsageError(`unexpected argument ${token}`)
    const name = token.slice(2)
    if (name === 'header' && commandName === 'enqueue') {
      const raw = argv[++index]
      if (raw === undefined) throw new UsageError('missing value for --header')
      const separator = raw.indexOf('=')
      if (separator <= 0) throw new UsageError('--header must be K=V')
      headers.push([raw.slice(0, separator), raw.slice(separator + 1)])
      continue
    }
    if (!VALUE_FLAGS[commandName].has(name)) throw new UsageError(`unknown option --${name}`)
    if (values.has(name)) throw new UsageError(`duplicate --${name}`)
    const value = argv[++index]
    if (value === undefined) throw new UsageError(`missing value for --${name}`)
    values.set(name, value)
  }
  if (!values.has('session-id')) throw new UsageError('missing --session-id')
  if (commandName === 'enqueue' && !values.has('kind')) throw new UsageError('missing --kind')
  if (commandName === 'enqueue' && !values.has('body')) throw new UsageError('missing --body')
  return { command: commandName, values, headers, assumeLocal }
}

const renderMessage = (message: Message): Omit<Message, 'body'> & { bodyBase64: string } => {
  const { body, ...fields } = message
  return { ...fields, bodyBase64: Buffer.from(body).toString('base64') }
}

interface CliDependencies {
  readonly open: (databasePath: string) => SessionProtocol
  readonly requireLocal: (databasePath: string, options: { assumeLocal?: boolean }) => string
}

export interface CliRunOptions {
  readonly argv?: readonly string[]
  readonly env?: SelfLaunchEnvironment
  readonly stdout?: (text: string) => void
  readonly stderr?: (text: string) => void
  readonly dependencies?: CliDependencies
}

const errorCode = (error: unknown): string => {
  if (error instanceof UsageError) return error.code
  if (error instanceof DatabasePathError) return error.code
  if (error instanceof LocalityError) return error.code
  if (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
    && error.code.startsWith('PROTOCOL_')
  ) return error.code
  return 'INTERNAL'
}

const SQLITE_EXPERIMENTAL_WARNING = 'SQLite is an experimental feature and might change at any time'

// @@@node-sqlite-warning - Node 22 emits this during import; suppress only that exact warning so the
// CLI's stderr remains its frozen single line while every unrelated warning keeps its normal path.
const loadOpenProtocol = async (): Promise<(databasePath: string) => SessionProtocol> => {
  const originalEmitWarning = process.emitWarning
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const message = warning instanceof Error ? warning.message : warning
    if (message === SQLITE_EXPERIMENTAL_WARNING) return
    Reflect.apply(originalEmitWarning, process, [warning, ...args])
  }) as typeof process.emitWarning
  try {
    return (await import('@spexcode/session-protocol')).openProtocol
  } finally {
    process.emitWarning = originalEmitWarning
  }
}

export async function runCli(options: CliRunOptions = {}): Promise<number> {
  const stdout = options.stdout ?? (text => process.stdout.write(text))
  const stderr = options.stderr ?? (text => process.stderr.write(text))
  let protocol: SessionProtocol | undefined

  try {
    const parsed = parseCommand(options.argv ?? process.argv.slice(2))
    const databasePath = resolveDatabasePath({
      databasePath: parsed.values.get('database-path'),
      env: options.env,
    })
    const dependencies = options.dependencies ?? {
      open: await loadOpenProtocol(),
      requireLocal: requireLocalDatabasePath,
    }
    dependencies.requireLocal(databasePath, { assumeLocal: parsed.assumeLocal })
    protocol = dependencies.open(databasePath)
    const sessionId = parsed.values.get('session-id')!

    let result: unknown
    if (parsed.command === 'initialize') {
      result = protocol.initialize(sessionId)
    } else if (parsed.command === 'enqueue') {
      const headers = Object.fromEntries(parsed.headers)
      result = renderMessage(protocol.enqueue(sessionId, {
        kind: parsed.values.get('kind')!,
        body: Buffer.from(parsed.values.get('body')!, 'utf8'),
        ...(parsed.values.has('sender-session-id')
          ? { senderSessionId: parsed.values.get('sender-session-id')! }
          : {}),
        ...(parsed.values.has('idempotency-key')
          ? { idempotencyKey: parsed.values.get('idempotency-key')! }
          : {}),
        ...(parsed.headers.length > 0 ? { headers } : {}),
      }))
    } else if (parsed.command === 'dequeue') {
      const message = protocol.dequeue(sessionId)
      result = message === null ? null : renderMessage(message)
    } else {
      result = protocol.listPending(sessionId).map(renderMessage)
    }
    stdout(`${JSON.stringify(result)}\n`)
    return 0
  } catch (error) {
    const code = errorCode(error)
    const message = error instanceof Error ? error.message : String(error)
    const repair = code === 'PROTOCOL_PATH_PARENT_MISSING'
      ? '; create the parent directory or choose --database-path with an existing parent'
      : ''
    stderr(`spex-session: ${code}: ${message}${repair}\n`)
    return code === 'USAGE' ? 2 : 1
  } finally {
    protocol?.close()
  }
}
