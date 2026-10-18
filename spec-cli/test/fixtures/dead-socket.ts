import { mkdirSync, renameSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname } from 'node:path'

export async function leaveDeadSocket(path: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true })
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, resolve)
  })
  const moved = `${path}.stale`
  try {
    renameSync(path, moved)
  } finally {
    // close unlinks the original listen path. Move the real socket inode back only after it is cold.
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
  renameSync(moved, path)
}
