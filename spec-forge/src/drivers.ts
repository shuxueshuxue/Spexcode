import type { ForgeDriver } from './port.js'
import { githubDriver } from './drivers/github.js'

export const FORGE_DRIVERS: ForgeDriver[] = [githubDriver]
export const DEFAULT_FORGE_HOST = 'github'

export function forgeDriverFor(host: string): ForgeDriver | undefined {
  return FORGE_DRIVERS.find((d) => d.host === host)
}

export function forgeIssueStores(): { id: string; label: string; kind: 'forge' }[] {
  return FORGE_DRIVERS.map((d) => ({ id: d.host, label: d.host, kind: 'forge' }))
}
