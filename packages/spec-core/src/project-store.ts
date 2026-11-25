import { homedir } from 'node:os'
import { join } from 'node:path'

// One pure identity seam for every project-scoped runtime consumer. Git discovery stays with callers;
// once they have the primary checkout, sessions, materialize, history indexes, backends, and uninstall
// all resolve the same top-level store.
export function spexcodeHome(): string {
  return process.env.SPEXCODE_HOME || join(homedir(), '.spexcode')
}

// A project's absolute path flattened into ONE directory name, so every runtime artifact for that project
// groups under it. Every character that cannot appear in a path segment has to go, and on Windows that is two
// more than on POSIX: the separator is `\\`, and an absolute path opens with a drive letter whose COLON is
// illegal in a filename. Leaving it in produced `…/projects/C:-Users-…`, and the mkdir for it failed — which
// took out `spex spec lint` and `spex graph --public --html` on every Windows machine. `:` and `\\` never
// occur in a POSIX absolute path, so an existing Linux or macOS store keeps the exact name it already has.
export function encodeProject(root: string): string {
  return root.replace(/[/\\:.]/g, '-')
}

export function projectRuntimeRoot(checkout: string): string {
  return join(spexcodeHome(), 'projects', encodeProject(checkout))
}
