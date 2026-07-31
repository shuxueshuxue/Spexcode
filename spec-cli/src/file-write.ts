import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'

export function writeFileIfChanged(path: string, content: string | Uint8Array): boolean {
  const next = Buffer.from(content)
  try {
    if (readFileSync(path).equals(next)) return false
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
  }
  writeFileSync(path, content)
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
