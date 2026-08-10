import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

// One pure identity seam for every project-scoped runtime consumer. Git discovery stays with callers;
// once they have the shared common dir, sessions, materialize, history indexes, backends, and uninstall
// all resolve the same top-level store.
export function spexcodeHome(): string {
  return process.env.SPEXCODE_HOME || join(homedir(), '.spexcode')
}

export function encodeProject(root: string): string {
  return root.replace(/[/.]/g, '-')
}

export function projectRuntimeRoot(commonDir: string): string {
  return join(spexcodeHome(), 'projects', encodeProject(dirname(commonDir)))
}
