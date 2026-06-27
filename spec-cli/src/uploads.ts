import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

// the backend's tmpdir — same /tmp home as the rendezvous sockets (sessions.ts), shared with the worker.
const UPLOAD_DIR = join(tmpdir(), 'spexcode-uploads')

// a generous ceiling so a stray huge upload can't quietly fill /tmp — over it we fail loud (the route 413s)
// rather than write. Real screenshots/attachments sit far under this.
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

// strip a client-supplied filename to a safe basename: no directory parts, only [A-Za-z0-9._-], no leading
// dots — so a crafted name (`../../etc/x`, `.bashrc`) can never escape UPLOAD_DIR. The extension is kept for
// readability; an empty/exotic name falls back to a generic stem.
function safeName(name: string): string {
  const base = basename(name || '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '')
  return base || 'upload'
}

let seq = 0

// write one uploaded file into UPLOAD_DIR under a collision-proof `<time>-<seq>-<name>` stem and return its
// absolute path — the string the dashboard splices into the prompt. Creates the dir on first use.
export async function saveUpload(file: File): Promise<string> {
  mkdirSync(UPLOAD_DIR, { recursive: true })
  const buf = Buffer.from(await file.arrayBuffer())
  const stamp = `${Date.now().toString(36)}-${(seq++).toString(36)}`
  const path = join(UPLOAD_DIR, `${stamp}-${safeName(file.name)}`)
  writeFileSync(path, buf)
  return path
}
