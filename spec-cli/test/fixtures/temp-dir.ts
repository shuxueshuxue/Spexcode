import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Fixtures serialize project paths and bind Unix sockets beneath their homes. Darwin's default
// temp directory is an alias with a long physical path; own a short, canonical directory instead.
export const fixtureTempDir = (prefix: string): string =>
  realpathSync(mkdtempSync(join(process.platform === 'darwin' ? '/tmp' : tmpdir(), prefix)))
