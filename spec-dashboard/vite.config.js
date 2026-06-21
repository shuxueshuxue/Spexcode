import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

// @@@ backend endpoint - where the dashboard proxies /api. Three sources, highest precedence first:
//   1. API_URL env                      — ad-hoc / remote backend, set at launch
//   2. spexcode.json `dashboard.apiUrl` — the per-project default (set once in the repo, no launch flag)
//   3. http://localhost:8787            — the default backend
// (2) is the answer to "point the dashboard without passing a port every time": in the normal layout the
// dashboard lives inside the repo, so its spexcode.json is found by walking up from cwd. The env still
// wins for a one-off or a remote endpoint. ws:true upgrades the live terminal's WebSocket through too.
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
