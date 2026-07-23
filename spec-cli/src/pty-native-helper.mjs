import { chmodSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

export function nodePtySpawnHelperPath(nativeModule) {
  const nativeAddon = Object.values(require.cache).find((loaded) => loaded?.exports === nativeModule)?.filename
  if (!nativeAddon) throw new Error('cannot locate node-pty loaded native addon')
  return join(dirname(nativeAddon), 'spawn-helper')
}

export function ensureExecutableIfPresent(path) {
  let mode
  try {
    mode = statSync(path).mode & 0o777
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  if ((mode & 0o111) !== 0o111) chmodSync(path, mode | 0o111)
}
