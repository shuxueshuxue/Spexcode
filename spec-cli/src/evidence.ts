import { readFileSync, writeFileSync } from 'node:fs'
import { apiBase } from './sessions.js'
import { blobPath, putBlob, readBlobByHash } from '@spexcode/spec-core'

export async function runEvidence(args: string[]): Promise<number> {
  if (args[0] === 'put' && args[1] !== undefined) return blobPut(args[1])
  if (args[0] === 'get') return blobGet(args.slice(1))
  console.error('spex evidence: put <file|-> — stash bytes in the shared evidence cache and print the content hash')
  console.error('           get <hash> [-o <file>] — read evidence back: local cache first, backend fallback')
  return 2
}

export function blobPut(file: string): number {
  let bytes: Buffer
  try { bytes = readFileSync(file === '-' ? 0 : file) } catch (e) {
    console.error(`spex evidence put: cannot read ${file}: ${(e as Error).message}`)
    return 2
  }
  if (bytes.length === 0) { console.error('spex evidence put: refusing empty evidence'); return 2 }
  console.log(putBlob(bytes))
  return 0
}

export async function blobGet(args: string[]): Promise<number> {
  const oIdx = args.indexOf('-o')
  const out = oIdx >= 0 ? args[oIdx + 1] : undefined
  if (oIdx >= 0 && (out === undefined || out.startsWith('-'))) { console.error('spex evidence get: -o needs a <file>'); return 2 }
  const hash = args.find((a, i) => (oIdx < 0 || (i !== oIdx && i !== oIdx + 1)) && !a.startsWith('-'))
  if (!hash) { console.error('spex evidence get: usage: spex evidence get <hash> [-o <file>]'); return 2 }

  const local = readBlobByHash(hash)
  if (local.ok) return emitBlob(local.bytes, out)
  if (local.reason === 'invalid') { console.error(`spex evidence get: bad hash '${hash}' — an evidence hash is 64 hex chars`); return 2 }

  const url = `${await apiBase()}/api/evidence/${hash}`
  let backendMiss: string
  try {
    const response = await fetch(url)
    if (response.ok) return emitBlob(Buffer.from(await response.arrayBuffer()), out)
    backendMiss = `HTTP ${response.status}`
  } catch (e) {
    backendMiss = `unreachable (${(e as Error).message})`
  }
  console.error(`spex evidence get: ${hash} — not found on either path:`)
  console.error(`  local cache: ${blobPath(hash)} — no such evidence (pruned, or put on another machine)`)
  console.error(`  backend:     ${url} — ${backendMiss}`)
  return 1
}

function emitBlob(bytes: Buffer, out?: string): number {
  if (out !== undefined) {
    try { writeFileSync(out, bytes) } catch (e) {
      console.error(`spex evidence get: cannot write ${out}: ${(e as Error).message}`)
      return 2
    }
    return 0
  }
  if (process.stdout.isTTY) console.error(`spex evidence get: writing ${bytes.length} raw bytes to a tty — pipe it or use -o <file>`)
  process.stdout.write(bytes)
  return 0
}
