import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// @@@ tsxBin - tsx's JS ENTRY (dist/cli.mjs), dev-or-published, run through `node` by the caller
// (`spawn(process.execPath, [tsxBin(pkgDir), entry, …])`). In the dev monorepo tsx sits in
// spec-cli/node_modules; in an installed `spexcode` package npm may hoist it to the consumer's node_modules
// — Node's own package resolver from spec-cli covers dev, global, and project-local installs in one rule.
// We resolve the .mjs entry rather than the `.bin/tsx` shim on purpose: the shim is an unspawnable sh
// script on Windows, so `node dist/cli.mjs` (identical to the shim on POSIX) is the one cross-platform form.
// `pkgDir` is the spec-cli directory.
export function tsxBin(pkgDir: string): string {
  try {
    const req = createRequire(join(pkgDir, 'package.json'))
    return join(dirname(req.resolve('tsx/package.json')), 'dist', 'cli.mjs')
  } catch {
    throw new Error(`tsx runtime not found from ${pkgDir} — run \`npm install\` in the SpexCode package`)
  }
}
