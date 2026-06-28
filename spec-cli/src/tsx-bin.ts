import { existsSync } from 'node:fs'
import { join } from 'node:path'

// @@@ tsxBin - where the tsx executable lives, dev-or-published. In the dev monorepo it sits in
// spec-cli/node_modules; in the PUBLISHED `spexcode` tarball spec-cli is a SUBDIR of the package, so tsx
// installs one level up at the package ROOT's node_modules. Resolve against both so the supervisor's child
// spawn and the baked launch/hook SPEX commands work in either layout. `pkgDir` is the spec-cli directory.
export function tsxBin(pkgDir: string): string {
  const candidates = [join(pkgDir, 'node_modules', '.bin', 'tsx'), join(pkgDir, '..', 'node_modules', '.bin', 'tsx')]
  return candidates.find(existsSync) ?? candidates[0]
}
