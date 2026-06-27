import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

// walk up from cwd to the nearest spexcode.json and read dashboard.apiUrl (null if none / unreadable).
function projectApiUrl() {
  for (let dir = process.cwd(); ; ) {
    const p = join(dir, 'spexcode.json')
    if (existsSync(p)) {
      try { return JSON.parse(readFileSync(p, 'utf8'))?.dashboard?.apiUrl || null } catch { return null }
    }
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

const target = process.env.API_URL || projectApiUrl() || 'http://localhost:8787'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': { target, ws: true } } },
})
