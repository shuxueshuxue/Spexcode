import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Fixtures serialize project paths and bind Unix sockets beneath their homes. Darwin's default
// temp directory is an alias with a long physical path; own a short, canonical directory instead.
const owned = new Set<string>()
process.once('exit', () => {
  for (const path of owned) rmSync(path, { recursive: true, force: true })
})

export function fixtureTempDir(prefix: string): string {
  const darwin = process.platform === 'darwin'
  const path = realpathSync(mkdtempSync(join(darwin ? '/tmp' : tmpdir(), darwin ? prefix.slice(0, 24) : prefix)))
  owned.add(path)
  return path
}
