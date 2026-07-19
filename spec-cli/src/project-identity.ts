import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { spexcodeHome } from './layout.js'
import {
  resolvedIdentityIcon, DEFAULT_GATEWAY_ICON, DEFAULT_PROJECT_ICON, requireIdentityPreset,
} from './identity-presets.js'

export type ResolvedIdentity = { title: string; icon: string }
export type GatewayIdentitySource = { identity: ResolvedIdentity; revision: string }

const revisionOf = (raw: string | null): string =>
  createHash('sha256').update(raw === null ? 'missing' : `present\0${raw}`).digest('hex')

function readObject(file: string): { value: Record<string, any>; raw: string | null } {
  if (!existsSync(file)) return { value: {}, raw: null }
  const raw = readFileSync(file, 'utf8')
  let value: unknown
  try { value = JSON.parse(raw) }
  catch (e) { throw new Error(`malformed ${file}: ${(e as Error).message}`) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${file} must contain one top-level JSON object`)
  return { value: value as Record<string, any>, raw }
}

export function resolveProjectIdentity(configRoot: string, canonicalRoot = configRoot): ResolvedIdentity {
  const { value } = readObject(join(configRoot, 'spexcode.json'))
  const dashboard = value.dashboard && typeof value.dashboard === 'object' && !Array.isArray(value.dashboard)
    ? value.dashboard as Record<string, unknown>
    : {}
  const configuredTitle = typeof dashboard.title === 'string' ? dashboard.title.trim() : ''
  return {
    title: configuredTitle || basename(canonicalRoot),
    icon: resolvedIdentityIcon(dashboard.icon, DEFAULT_PROJECT_ICON),
  }
}

export const hostConfigPath = (): string => join(spexcodeHome(), 'config.json')

export function readGatewayIdentity(): GatewayIdentitySource {
  const { value, raw } = readObject(hostConfigPath())
  const gateway = value.gateway && typeof value.gateway === 'object' && !Array.isArray(value.gateway)
    ? value.gateway as Record<string, unknown>
    : {}
  return {
    identity: { title: 'Projects', icon: resolvedIdentityIcon(gateway.icon, DEFAULT_GATEWAY_ICON) },
    revision: revisionOf(raw),
  }
}

export function writeGatewayIcon(icon: unknown, revision: string): GatewayIdentitySource {
  const canonical = requireIdentityPreset(icon)
  const file = hostConfigPath()
  const current = readObject(file)
  if (revision !== revisionOf(current.raw)) {
    const error = new Error('host config changed on disk — reload before saving') as Error & { status?: number }
    error.status = 409
    throw error
  }
  const gateway = current.value.gateway && typeof current.value.gateway === 'object' && !Array.isArray(current.value.gateway)
    ? current.value.gateway as Record<string, unknown>
    : {}
  const next = { ...current.value, gateway: { ...gateway, icon: canonical } }
  const raw = `${JSON.stringify(next, null, 2)}\n`
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, raw, { mode: 0o600 })
    renameSync(tmp, file)
  } finally {
    try { rmSync(tmp) } catch { /* rename consumed it / write never created it */ }
  }
  return { identity: { title: 'Projects', icon: canonical }, revision: revisionOf(raw) }
}
