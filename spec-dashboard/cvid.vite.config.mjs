import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const target = process.env.API_URL || 'http://127.0.0.1:9020'

export default defineConfig({
  plugins: [react()],
  cacheDir: '/tmp/claude-1000/cvid/vite-cache',
  server: { host: '127.0.0.1', proxy: { '/api': { target, ws: true } } },
})
