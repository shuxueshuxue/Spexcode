import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// @@@ tsxBin - where the tsx executable lives, dev-or-published. In the dev monorepo it sits in
// spec-cli/node_modules; in an installed `spexcode` package npm may hoist it to the consumer's node_modules
// instead of nesting it under the package. Resolve explicit local candidates first, then let Node's own
// package resolver walk upward from spec-cli so dev, global, and project-local installs share one mechanism.
// `pkgDir` is the spec-cli directory.
export function tsxBin(pkgDir: string): string {
  const candidates = [join(pkgDir, 'node_modules', '.bin', 'tsx'), join(pkgDir, '..', 'node_modules', '.bin', 'tsx')]
  const local = candidates.find(existsSync)
  if (local) return local
  try {
    const req = createRequire(join(pkgDir, 'package.json'))
    return join(dirname(req.resolve('tsx/package.json')), 'dist', 'cli.mjs')
  } catch {
    return candidates[0]
  }
}
