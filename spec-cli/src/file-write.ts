import { chmodSync, copyFileSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

// A differing target is replaced by rename, never rewritten in place: a concurrent reader — codex re-reading its
// own config.toml, a harness loading its hooks file — sees the old bytes or the new bytes, never a truncated
// middle. The replacement lands on the real file behind a symlink and keeps that file's mode.
export function writeFileIfChanged(path: string, content: string | Uint8Array): boolean {
  const next = Buffer.from(content)
  let target = path
  let mode: number | undefined
  try {
    if (readFileSync(path).equals(next)) return false
    target = realpathSync(path)
    mode = statSync(target).mode
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
  }
  const staged = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`)
  writeFileSync(staged, next)
  if (mode !== undefined) chmodSync(staged, mode)
  renameSync(staged, target)
  return true
}

export function copyFileIfChanged(source: string, target: string): boolean {
  try {
    if (readFileSync(target).equals(readFileSync(source))) return false
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
  }
  copyFileSync(source, target)
  return true
}
