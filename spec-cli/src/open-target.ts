import { existsSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { loadSpecsLite, mainRoot, type SpecLite } from '@spexcode/spec-core'
import { localCachedSessions } from './client.js'
import { resolveSession, type Session } from './sessions.js'

export type OpenTarget =
  | { kind: 'node'; id: string; hash: string }
  | { kind: 'session'; id: string; hash: string }
  | { kind: 'file'; path: string; hash: string }

function routeHash(page: string, value: string): string {
  return `#/${page}/${value.split('/').map(encodeURIComponent).join('/')}`
}

function nodeReference(value: string): string {
  const trimmed = value.trim()
  const wrapped = /^\[\[(.+)\]\]$/.exec(trimmed)
  return wrapped ? wrapped[1] : trimmed
}

export function resolveOpenTarget(
  value: string,
  options: { root?: string; specs?: Pick<SpecLite, 'id'>[]; sessions?: Session[]; cwd?: string } = {},
): OpenTarget {
  const input = value.trim()
  if (!input) throw new Error('target is empty')
  const root = realpathSync(options.root ?? mainRoot())

  const nodeId = nodeReference(input)
  if ((options.specs ?? loadSpecsLite()).some((node) => node.id === nodeId)) {
    return { kind: 'node', id: nodeId, hash: routeHash('spec', nodeId) }
  }

  const resolvedSession = resolveSession(input, options.sessions ?? localCachedSessions(true), undefined, options.cwd ?? process.cwd())
  if ('ok' in resolvedSession) {
    return { kind: 'session', id: resolvedSession.ok.id, hash: routeHash('sessions', resolvedSession.ok.id) }
  }
  if ('ambiguous' in resolvedSession) {
    throw new Error(`session selector '${input}' is ambiguous (${resolvedSession.ambiguous.map((session) => session.id.slice(0, 8)).join(', ')})`)
  }

  const unresolved = resolve(options.cwd ?? process.cwd(), input)
  if (!existsSync(unresolved)) throw new Error(`path '${input}' is not a file`)
  const candidate = realpathSync(unresolved)
  const rel = relative(root, candidate)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`path '${input}' is outside the project`)
  }
  if (!statSync(candidate).isFile()) throw new Error(`path '${input}' is not a file`)
  const path = rel.split(sep).join('/')
  return { kind: 'file', path, hash: routeHash('file', path) }
}
